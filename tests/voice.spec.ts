import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    voiceConnections: RTCPeerConnection[];
  }
}

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // Use numeric host candidates on the local headless test network.
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  },
});

// Observe native browser connections, without replacing negotiation or media.
async function audioStats(page: Page) {
  return page.evaluate(async () => {
    const connections = window.voiceConnections.filter((pc) => pc.connectionState !== 'closed');
    let receivedEnergy = 0;
    let receivedBytes = 0;
    let relayedConnections = 0;
    let audibleStreams = 0;
    const codecs: string[] = [];
    for (const connection of connections) {
      const stats = await connection.getStats();
      stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          const pair = stats.get(report.selectedCandidatePairId);
          if (pair && stats.get(pair.localCandidateId)?.candidateType === 'relay')
            relayedConnections++;
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          receivedEnergy += report.totalAudioEnergy ?? 0;
          if (report.totalAudioEnergy > 0) audibleStreams++;
          receivedBytes += report.bytesReceived ?? 0;
          const codec = stats.get(report.codecId);
          if (codec) codecs.push(codec.mimeType);
        }
      });
    }
    return {
      receivedEnergy,
      receivedBytes,
      relayedConnections,
      audibleStreams,
      codecs,
      connected: connections.filter((pc) => pc.connectionState === 'connected').length,
      states: connections.map(
        (pc) => `${pc.connectionState}/${pc.iceConnectionState}/${pc.signalingState}`,
      ),
      microphone: connections.some((pc) =>
        pc.getSenders().some((sender) => sender.track?.readyState === 'live'),
      ),
      transmitting: connections.some((pc) =>
        pc.getSenders().some((sender) => sender.track?.enabled),
      ),
    };
  });
}

for (const players of [2, 4]) {
  test(`Opus voice with ${players} players supports room permissions, push-to-talk and cleanup`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(60000);
    const spectatorsCanSpeak = players === 4;
    const contexts = await Promise.all(
      Array.from({ length: players + 1 }, () =>
        browser.newContext({
          viewport: testInfo.project.use.viewport,
          permissions: ['microphone'],
        }),
      ),
    );
    const apiOrigin = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
    const headers = { Origin: baseURL! };
    try {
      for (const [index, context] of contexts.entries()) {
        await context.addInitScript(
          ({ relayOnly }) => {
            window.voiceConnections = [];
            const NativeConnection = window.RTCPeerConnection;
            window.RTCPeerConnection = class extends NativeConnection {
              constructor(config?: RTCConfiguration) {
                super({
                  ...config,
                  ...(relayOnly ? { iceTransportPolicy: 'relay' as const } : {}),
                });
                window.voiceConnections.push(this);
              }
            };
          },
          { relayOnly: process.env.VOICE_TEST_RELAY === 'true' },
        );
        const response = await context.request.post(`${apiOrigin}/api/guest`, {
          headers,
          data: { name: ['Ana voz', 'Beto voz', 'Carla voz', 'Diego voz', 'Eva mira'][index] },
        });
        expect(response.ok()).toBe(true);
      }
      const created = await contexts[0].request.post(`${apiOrigin}/api/matches`, {
        headers,
        data: {
          private: true,
          config: { players, target: 12, florRequired: false },
          options: { spectatorsCanSpeak },
        },
      });
      expect(created.ok()).toBe(true);
      const { code } = await created.json();
      for (const context of contexts.slice(1, players)) {
        expect(
          (
            await context.request.post(`${apiOrigin}/api/matches/${code}/join`, {
              headers,
              data: {},
            })
          ).ok(),
        ).toBe(true);
      }
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const [first, second] = pages;
      const spectator = pages[players];
      await first.clock.install();
      await first.goto(`${baseURL}/configuracion`);
      await first.getByRole('radio', { name: /Micrófono abierto/ }).check();
      await expect(first.getByRole('status')).toHaveText(
        'Preferencia guardada en este dispositivo.',
      );
      await first.reload();
      await expect(first.getByRole('radio', { name: /Micrófono abierto/ })).toBeChecked();
      for (const page of pages) {
        await page.goto(`${baseURL}/mesa/${code}`);
        await page.getByRole('button', { name: 'Entrar al audio', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Salir del audio' })).toBeVisible();
      }
      await second
        .getByRole('combobox', { name: 'Modo de voz', exact: true })
        .selectOption('push-to-talk');
      await expect(second.getByRole('button', { name: 'Mantén para hablar · V' })).toBeVisible();
      if (spectatorsCanSpeak) {
        for (const page of pages.slice(2)) {
          await page
            .getByRole('combobox', { name: 'Modo de voz', exact: true })
            .selectOption('live');
        }
      } else {
        await expect(
          spectator.getByRole('combobox', { name: 'Modo de voz', exact: true }),
        ).toHaveCount(0);
      }
      await expect
        .poll(async () => (await audioStats(spectator)).states)
        .toEqual(
          Array.from({ length: players }, () =>
            expect.stringMatching(/^connected\/(connected|completed)\/stable$/),
          ),
        );
      await expect.poll(async () => (await audioStats(second)).receivedEnergy).toBeGreaterThan(0);
      await expect
        .poll(async () => (await audioStats(spectator)).receivedEnergy)
        .toBeGreaterThan(0);
      if (process.env.VOICE_TEST_RELAY === 'true') {
        expect((await audioStats(spectator)).relayedConnections).toBe(players);
      }
      expect((await audioStats(spectator)).microphone).toBe(spectatorsCanSpeak);
      expect((await audioStats(second)).transmitting).toBe(false);
      const negotiatedCodecs = (await audioStats(second)).codecs;
      expect(negotiatedCodecs.length).toBeGreaterThan(0);
      expect(negotiatedCodecs.every((codec) => codec.toLowerCase() === 'audio/opus')).toBe(true);

      await second.getByRole('button', { name: 'Abrir chat', exact: true }).click();
      await second.getByPlaceholder('Di algo…').click();
      await second.keyboard.down('v');
      expect((await audioStats(second)).transmitting).toBe(false);
      await second.keyboard.up('v');
      await second.getByRole('button', { name: 'Cerrar chat' }).click();

      // The shortcut only transmits while held outside text inputs.
      await second.locator('.voice-status').click();
      await second.keyboard.down('v');
      await expect.poll(async () => (await audioStats(second)).transmitting).toBe(true);
      await expect.poll(async () => (await audioStats(first)).receivedEnergy).toBeGreaterThan(0);
      if (spectatorsCanSpeak) {
        // Every player and the permitted spectator must receive every other voice.
        for (const page of pages) {
          await expect.poll(async () => (await audioStats(page)).audibleStreams).toBe(players);
        }
      }
      await second.keyboard.up('v');
      await expect.poll(async () => (await audioStats(second)).transmitting).toBe(false);
      const pushButton = second.getByRole('button', { name: 'Mantén para hablar · V' });
      await pushButton.scrollIntoViewIfNeeded();
      const buttonBounds = await pushButton.boundingBox();
      expect(buttonBounds).not.toBeNull();
      await second.mouse.move(
        buttonBounds!.x + buttonBounds!.width / 2,
        buttonBounds!.y + buttonBounds!.height / 2,
      );
      await second.mouse.down();
      await expect.poll(async () => (await audioStats(second)).transmitting).toBe(true);
      await second.mouse.up();
      await expect.poll(async () => (await audioStats(second)).transmitting).toBe(false);
      if (players === 2) {
        const beforeRefresh = await first.evaluate(
          () => window.voiceConnections[0].localDescription?.sdp,
        );
        await first.clock.fastForward(30 * 60 * 1000 + 1000);
        await expect
          .poll(() => first.evaluate(() => window.voiceConnections[0].localDescription?.sdp))
          .not.toBe(beforeRefresh);
        await expect.poll(async () => (await audioStats(first)).connected).toBe(2);
        const received = (await audioStats(second)).receivedBytes;
        await expect
          .poll(async () => (await audioStats(second)).receivedBytes)
          .toBeGreaterThan(received);
      }
      await first.getByRole('button', { name: 'Silenciar micrófono' }).click();
      await expect.poll(async () => (await audioStats(first)).transmitting).toBe(false);
      await first.getByRole('button', { name: 'Salir del audio' }).click();
      await expect.poll(async () => (await audioStats(first)).microphone).toBe(false);
      await expect(spectator.getByText(`${players} en audio`, { exact: true })).toBeVisible();
      await spectator.screenshot({
        path: `output/playwright/voice-${players}-${testInfo.project.name}.png`,
        fullPage: true,
      });
    } catch (error) {
      for (const [index, context] of contexts.entries()) {
        const page = context.pages()[0];
        if (!page) continue;
        const diagnostics = await page.evaluate(async () =>
          Promise.all(
            window.voiceConnections.map(async (connection) => {
              const stats: object[] = [];
              (await connection.getStats()).forEach((report) => {
                if (report.type.includes('candidate') || report.type === 'transport')
                  stats.push(report);
              });
              return {
                state: connection.connectionState,
                local: connection.localDescription?.sdp,
                remote: connection.remoteDescription?.sdp,
                stats,
              };
            }),
          ),
        );
        await testInfo.attach(`voice-peer-${index}`, {
          body: JSON.stringify(diagnostics, null, 2),
          contentType: 'application/json',
        });
      }
      throw error;
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  });
}
