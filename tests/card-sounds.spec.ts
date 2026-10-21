import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    cardAudio: { contexts: AudioContext[]; starts: number; peak: number };
  }
}

test('card effects play through Web Audio and mute independently of voice', async ({
  browser,
  baseURL,
}, testInfo) => {
  const contexts = await Promise.all(
    Array.from({ length: 2 }, () => browser.newContext({ ...testInfo.project.use, baseURL })),
  );
  const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
  const headers = { Origin: baseURL! };
  try {
    for (const [index, context] of contexts.entries()) {
      await context.addInitScript(() => {
        window.cardAudio = { contexts: [], starts: 0, peak: 0 };
        const NativeContext = window.AudioContext;
        window.AudioContext = class extends NativeContext {
          private analyser: AnalyserNode;
          constructor(options?: AudioContextOptions) {
            super(options);
            window.cardAudio.contexts.push(this);
            this.analyser = this.createAnalyser();
            this.analyser.fftSize = 256;
            const samples = new Float32Array(256);
            const measure = () => {
              this.analyser.getFloatTimeDomainData(samples);
              for (const sample of samples)
                window.cardAudio.peak = Math.max(window.cardAudio.peak, Math.abs(sample));
              if (this.state !== 'closed') requestAnimationFrame(measure);
            };
            requestAnimationFrame(measure);
          }
          createBufferSource() {
            const source = super.createBufferSource();
            source.connect(this.analyser);
            const start = source.start.bind(source);
            source.start = (...args) => {
              window.cardAudio.starts++;
              start(...args);
            };
            return source;
          }
        };
      });
      const guest = await context.request.post(`${api}/api/guest`, {
        headers,
        data: { name: `Sonidos ${index + 1}` },
      });
      expect(guest.ok()).toBe(true);
    }
    const created = await contexts[0].request.post(`${api}/api/matches`, {
      headers,
      data: { private: true, config: { players: 2, target: 24, florRequired: false } },
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json();
    expect(
      (
        await contexts[1].request.post(`${api}/api/matches/${code}/join`, { headers, data: {} })
      ).ok(),
    ).toBe(true);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of pages) {
      await page.goto(`/mesa/${code}`);
      await expect(page.getByText('En línea', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.cardAudio.contexts.length)).toBe(0);
      await page.getByText('En línea', { exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.cardAudio.contexts[0]?.state))
        .toBe('running');
      expect(await page.evaluate(() => window.cardAudio.starts)).toBe(0);
    }
    for (const page of pages) {
      const cut = page.getByRole('button', { name: 'Partir el mazo', exact: true });
      if (await cut.isVisible()) {
        await cut.click();
        break;
      }
    }
    for (const page of pages) {
      await expect.poll(() => page.evaluate(() => window.cardAudio.starts)).toBe(6);
      await expect.poll(() => page.evaluate(() => window.cardAudio.peak)).toBeGreaterThan(0.005);
      await expect(page.locator('[data-card-flight]')).toHaveCount(0);
    }
    const observer = pages[0];
    await observer.getByRole('button', { name: 'Silenciar cartas', exact: true }).click();
    for (const page of pages) {
      const playable = page.locator('.hand-card:not(:disabled)');
      if (await playable.count()) {
        await playable.first().press('Enter');
        break;
      }
    }
    await expect(observer.locator('.played-card')).toHaveCount(1);
    expect(await observer.evaluate(() => window.cardAudio.starts)).toBe(6);
    await expect.poll(() => pages[1].evaluate(() => window.cardAudio.starts)).toBe(7);
    const details = observer.getByRole('button', { name: 'Detalles de la partida', exact: true });
    if (await details.isVisible()) await details.click();
    await expect(
      observer.getByRole('button', { name: 'Entrar al audio', exact: true }),
    ).toBeVisible();
    const closeDetails = observer
      .locator('.match-details')
      .getByRole('button', { name: 'Cerrar detalles', exact: true });
    if (await closeDetails.isVisible()) await closeDetails.click();

    await observer.getByRole('button', { name: 'Activar sonidos de cartas', exact: true }).click();
    await observer.emulateMedia({ reducedMotion: 'reduce' });
    for (const page of pages) {
      const playable = page.locator('.hand-card:not(:disabled)');
      if (await playable.count()) {
        await playable.first().press('Enter');
        break;
      }
    }
    await expect(observer.locator('.played-card')).toHaveCount(2);
    await expect.poll(() => observer.evaluate(() => window.cardAudio.starts)).toBe(7);
    await observer.getByRole('button', { name: 'Silenciar cartas', exact: true }).click();
    await observer.reload();
    await expect(
      observer.getByRole('button', { name: 'Activar sonidos de cartas', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await observer.evaluate(() => window.cardAudio.starts)).toBe(0);

    const settings = await contexts[0].newPage();
    await settings.goto('/configuracion');
    const enabled = settings.getByRole('checkbox', { name: /Sonidos al repartir y jugar/ });
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await expect(
      observer.getByRole('button', { name: 'Silenciar cartas', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await settings.reload();
    await expect(enabled).toBeChecked();
    await observer.bringToFront();
    await observer.getByText('En línea', { exact: true }).click();
    await observer.locator('a.brand').click();
    await expect
      .poll(() => observer.evaluate(() => window.cardAudio.contexts[0]?.state))
      .toBe('closed');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
