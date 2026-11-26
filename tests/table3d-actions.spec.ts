import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { Card, Command, Snapshot } from '../src/lib/protocol.js';
import { showTable, tableSnapshot } from './fixtures/table.js';

const portrait = { width: 360, height: 740 };
const landscape = { width: 740, height: 360 };
const scene = (page: Page) => page.locator('[role="application"]:has(canvas)');
const caption = (page: Page) => scene(page).locator('[role="status"]');
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole('button', { name, exact: true });

async function choose3D(page: Page) {
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
}

async function expectScene(page: Page) {
  await expect(scene(page)).toHaveAttribute('aria-hidden', 'false');
  const { width, height } = page.viewportSize()!;
  expect(await scene(page).locator('canvas').boundingBox()).toEqual({ x: 0, y: 0, width, height });
}

async function press(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 0.99 });
  if (await control.page().evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
  else await control.click();
}

async function pickFromFan(page: Page, card: Card) {
  const suits = { coins: 'oros', cups: 'copas', spades: 'espadas', clubs: 'bastos' };
  const name = `${card.number} de ${suits[card.suit]}`;
  const label = scene(page)
    .locator('.held-card-label')
    .filter({ hasText: new RegExp(`^${name}$`) });
  const { width, height } = page.viewportSize()!;
  let point = { x: 0, y: 0 };
  await expect
    .poll(
      async () => {
        for (const row of [0.62, 0.56, 0.68, 0.51, 0.73]) {
          for (const column of [0.33, 0.5, 0.67, 0.25, 0.75]) {
            point = { x: Math.round(column * width), y: Math.round(row * height) };
            await page.mouse.move(point.x, point.y);
            if (await label.isVisible()) return true;
          }
        }
        return false;
      },
      { message: `Find ${name} in the held fan` },
    )
    .toBe(true);
  const { x, y } = point;
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x, y }),
  ).toBe('CANVAS');
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function onlineTable(browser: Browser, testInfo: TestInfo, names: string[], players: number) {
  const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
  const headers = { Origin: testInfo.project.use.baseURL! };
  const clients = await Promise.all(
    names.map(() => browser.newContext({ ...testInfo.project.use, viewport: portrait })),
  );
  const close = () => Promise.all(clients.map((client) => client.close()));
  try {
    for (const [seat, name] of names.entries()) {
      const response = await clients[seat].request.post(`${api}/api/guest`, {
        headers,
        data: { name },
      });
      await expect(response).toBeOK();
    }
    const created = await clients[0].request.post(`${api}/api/matches`, {
      headers,
      data: { private: true, config: { players, target: 24, florRequired: false } },
    });
    await expect(created).toBeOK();
    const { code } = (await created.json()) as { code: string };
    for (let seat = 1; seat < players; seat++) {
      const joined = await clients[seat].request.post(`${api}/api/matches/${code}/join`, {
        headers,
        data: { seat },
      });
      await expect(joined).toBeOK();
    }
    return {
      close,
      async view(seat: number) {
        const page = await clients[seat].newPage();
        await choose3D(page);
        const updates: Snapshot[] = [];
        const commands: Command[] = [];
        page.on('websocket', (socket) => {
          if (!socket.url().includes(`/api/matches/${code}/ws?`)) return;
          socket.on('framereceived', ({ payload }) => {
            const message = JSON.parse(payload.toString());
            if (message.type === 'snapshot' || message.type === 'game_update')
              updates.push(message.data as Snapshot);
          });
          socket.on('framesent', ({ payload }) => {
            const command = JSON.parse(payload.toString()).input?.command;
            if (command?.type) commands.push(command);
          });
        });
        await page.goto(`/mesa/${code}`);
        await expect(page.getByText('En línea', { exact: true })).toBeVisible();
        await expectScene(page);
        return { page, updates, commands };
      },
      async snapshot(seat: number): Promise<Snapshot> {
        const response = await clients[seat].request.get(`${api}/api/matches/${code}`);
        await expect(response).toBeOK();
        return response.json();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

test('voluntary pegado sends the chosen order and burns stay concealed for the other phone', async ({
  browser,
}, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, 'The live round exercises touch input.');
  test.setTimeout(60_000);
  const room = await onlineTable(browser, testInfo, ['Ana apila', 'Beto apila'], 2);
  try {
    const views = await Promise.all([room.view(0), room.view(1)]);
    const cutter = (await room.snapshot(0)).state!.turn;
    await press(button(views[cutter].page, 'Partir el mazo'));
    await expect.poll(async () => (await room.snapshot(0)).state!.phase).toBe('playing');
    const [first, second] = await Promise.all([room.snapshot(0), room.snapshot(1)]);
    // Different card numbers guarantee a decisive opening trick in every deal.
    const opening = [
      first.state!.hand.find(({ card }) =>
        second.state!.hand.some((held) => held.card.number !== card.number),
      )!,
    ];
    opening.push(second.state!.hand.find(({ card }) => card.number !== opening[0].card.number)!);
    for (let action = 0; action < 2; action++) {
      const seat = (await room.snapshot(0)).state!.turn;
      const { page } = views[seat];
      const choice = opening[seat];
      await press(button(page, 'Mirar las cartas'));
      await pickFromFan(page, choice.card);
      await expect
        .poll(async () => (await room.snapshot(0)).state!.seats[seat].plays[0].present)
        .toBe(true);
    }

    const round = (await room.snapshot(0)).state!;
    expect(round.round).toBe(1);
    expect(round.mandatoryStack).toBe(false);
    const stacker = round.turn;
    const opponent = 1 - stacker;
    const [top, bottom] = (await room.snapshot(stacker)).state!.hand.filter(({ used }) => !used);
    const stackView = views[stacker];
    await press(button(stackView.page, 'Jugar pegado'));
    const submit = button(stackView.page, 'Jugar las dos');
    await expect(submit).toBeDisabled();
    await pickFromFan(stackView.page, bottom.card);
    await expect(submit).toBeDisabled();
    await pickFromFan(stackView.page, top.card);
    await press(submit);
    await expect
      .poll(() => stackView.commands.at(-1))
      .toEqual({
        type: 'stack',
        card: bottom.index,
        top: top.index,
        declaration: '',
      });

    const otherView = views[opponent];
    await expect.poll(() => otherView.updates.at(-1)?.state?.turn).toBe(opponent);
    const otherState = otherView.updates.at(-1)!.state!;
    expect(otherState.seats[stacker].plays[1]).toEqual({
      present: true,
      burned: false,
      concealed: true,
    });
    expect(otherState.seats[stacker].plays[2]).toEqual({
      card: top.card,
      present: true,
      burned: false,
      concealed: false,
    });
    expect(otherState.hand.map(({ card }) => card)).not.toContainEqual(bottom.card);

    const burned = otherState.hand.find(({ used }) => !used)!;
    await press(button(otherView.page, 'Quemar carta'));
    await pickFromFan(otherView.page, burned.card);
    await expect
      .poll(() => otherView.commands.at(-1))
      .toEqual({ type: 'burn', card: burned.index, declaration: '' });
    await expect
      .poll(() => stackView.updates.at(-1)?.state?.seats[opponent].plays[1])
      .toEqual({
        present: true,
        burned: true,
        concealed: false,
      });
    expect((await room.snapshot(opponent)).state!.hand.filter(({ used }) => !used)).toHaveLength(1);
  } finally {
    await room.close();
  }
});

test('mandatory pegado requires choosing a bottom and top from the held fan before sending', async ({
  page,
}) => {
  await page.setViewportSize(portrait);
  await choose3D(page);
  const snapshot = tableSnapshot(2, 1, false);
  const game = snapshot.state!;
  // Both sides opened with a three, as in the backend mandatory-pegado fixture.
  game.vira = { suit: 'spades', number: 4 };
  const held: Card[] = [
    { suit: 'coins', number: 3 },
    { suit: 'coins', number: 4 },
    { suit: 'spades', number: 1 },
  ];
  game.hand = held.map((card, index) => ({ index, card, used: index === 0 }));
  game.seats[0].plays[0].card = game.hand[0].card;
  game.seats[1].plays[0].card = { suit: 'clubs', number: 3 };
  game.mandatoryStack = true;
  game.legal = [
    { type: 'stack', card: 1, top: 2 },
    { type: 'stack', card: 2, top: 1 },
    { type: 'burn' },
  ];
  const sent: Command[] = [];
  await showTable(page, snapshot, (command) => sent.push(command));
  await expectScene(page);
  await expect(button(page, 'Jugando pegado')).toBeDisabled();
  await expect(button(page, 'Quemar las dos')).toBeEnabled();
  await expect(page.getByText('Primero elige abajo; después, arriba.')).toBeVisible();
  const submit = button(page, 'Jugar las dos');
  await expect(submit).toBeDisabled();
  await press(button(page, 'Mirar las cartas'));
  await pickFromFan(page, game.hand[2].card);
  await expect(submit).toBeDisabled();
  await pickFromFan(page, game.hand[1].card);
  expect(sent).toEqual([]);
  await press(submit);
  await expect.poll(() => sent).toEqual([{ type: 'stack', card: 2, top: 1, declaration: '' }]);
});

test('an optional flor declaration reaches a 3D burn and cancel keeps the choice local', async ({
  page,
}) => {
  await page.setViewportSize(portrait);
  await choose3D(page);
  const snapshot = tableSnapshot(2, 1, false);
  const game = snapshot.state!;
  game.florValid = true;
  game.holding = { envido: 33, flor: 36, receta: false };
  game.hand = [3, 7, 6].map((number, index) => ({
    index,
    card: { suit: 'coins', number },
    used: index === 0,
  }));
  game.seats[0].plays[0].card = game.hand[0].card;
  game.legal = [
    { type: 'burn', card: 1 },
    { type: 'burn', card: 2 },
    { type: 'burn', card: 1, declaration: 'flor' },
    { type: 'burn', card: 2, declaration: 'flor' },
  ];
  const sent: Command[] = [];
  await showTable(page, snapshot, (command) => sent.push(command));
  await expectScene(page);
  const burn = button(page, 'Quemar carta');
  const hint = page.getByText('Elige una carta para quemarla y pasar el turno.');
  await press(burn);
  await expect(hint).toBeVisible();
  await press(button(page, 'Cancelar quemado'));
  await expect(hint).toHaveCount(0);
  expect(sent).toEqual([]);
  await press(button(page, 'Decir…'));
  const declarations = page.getByRole('dialog');
  await expect(button(declarations, 'Presento flor')).toBeDisabled();
  await press(button(declarations, 'Flor'));
  await press(burn);
  await press(button(page, 'Mirar las cartas'));
  await pickFromFan(page, game.hand[1].card);
  await expect.poll(() => sent).toEqual([{ type: 'burn', card: 1, declaration: 'flor' }]);
  await expect(button(page, 'Decir…')).toBeVisible();
});

test('landscape canto raises and replies remain usable as the 3D speaker animates', async ({
  page,
}) => {
  await page.setViewportSize(landscape);
  await choose3D(page);
  const snapshot = tableSnapshot(2, 0, false);
  snapshot.state!.turn = 1;
  const sent: Command[] = [];
  const update = await showTable(page, snapshot, (command) => sent.push(command));
  await expectScene(page);
  const bid = structuredClone(snapshot);
  bid.state!.revision++;
  bid.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
  bid.state!.legal = [
    { type: 'respond', kind: 'accept' },
    { type: 'respond', kind: 'decline' },
    { type: 'respond', kind: 'raise', amount: 6 },
  ];
  bid.events!.push({ id: 3, hand: 1, event: { type: 'call', seat: 1, kind: 'truco', amount: 3 } });
  update(bid);
  await expect(caption(page)).toHaveText('CPU 1 Truco');
  await press(button(page, 'Subir / otros'));
  await expect(caption(page)).toHaveText('CPU 1 Truco');
  await press(button(page.getByRole('dialog'), 'Quiero y retruco'));
  await expect.poll(() => sent).toEqual([{ type: 'respond', kind: 'raise', amount: 6 }]);

  const raisedBack = structuredClone(bid);
  raisedBack.state!.revision += 2;
  raisedBack.state!.pending = { kind: 'truco', caller: 1, value: 9, previous: 6, terminal: false };
  raisedBack.state!.legal = [
    { type: 'respond', kind: 'accept' },
    { type: 'respond', kind: 'decline' },
    { type: 'respond', kind: 'raise', amount: 100 },
  ];
  raisedBack.events!.push(
    {
      id: 4,
      hand: 1,
      event: { type: 'respond', seat: 0, kind: 'raise', canto: 'truco', amount: 6 },
    },
    {
      id: 5,
      hand: 1,
      event: { type: 'respond', seat: 1, kind: 'raise', canto: 'truco', amount: 9 },
    },
  );
  update(raisedBack);
  await expect(caption(page)).toHaveText('CPU 1 Quiero y vale 9');
  await press(button(page, 'Quiero'));
  await expect
    .poll(() => sent)
    .toEqual([
      { type: 'respond', kind: 'raise', amount: 6 },
      { type: 'respond', kind: 'accept' },
    ]);
});

async function recordCues(page: Page) {
  return scene(page).evaluateHandle((element) => {
    const log: string[] = [];
    const observer = new MutationObserver(() => {
      const cue = element
        .querySelector('[role="status"]')
        ?.textContent?.trim()
        .replace(/\s+/g, ' ');
      if (cue && cue !== log.at(-1)) log.push(cue);
    });
    observer.observe(element, { subtree: true, childList: true, characterData: true });
    return log;
  });
}

test('2v2 3D signals use the authorized view and changing seats does not replay them', async ({
  browser,
}, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, 'The live spectator flow exercises touch input.');
  test.setTimeout(60_000);
  const room = await onlineTable(
    browser,
    testInfo,
    ['Ana guiña', 'Beto mira', 'Carla juega', 'Diego juega', 'Eva observa'],
    4,
  );
  try {
    const cutterSeat = (await room.snapshot(0)).state!.turn;
    const cutter = await room.view(cutterSeat);
    await press(button(cutter.page, 'Partir el mazo'));
    await expect.poll(async () => (await room.snapshot(0)).state!.phase).toBe('playing');
    if (cutterSeat % 2 === 1) await cutter.page.close();
    const [sender, teammate, observer] = await Promise.all([
      cutterSeat === 0 ? cutter : room.view(0),
      cutterSeat === 2 ? cutter : room.view(2),
      room.view(4),
    ]);
    const watcher = observer.page;
    const chooseSeat = async (name: string) => {
      const seats = watcher.getByRole('combobox', { name: 'Estás mirando desde el puesto de' });
      await expect(seats).toBeInViewport({ ratio: 0.99 });
      expect(
        await seats.evaluate((select) => {
          const { x, y, width, height } = select.getBoundingClientRect();
          return document.elementFromPoint(x + width / 2, y + height / 2) === select;
        }),
      ).toBe(true);
      await seats.selectOption({ label: name });
      await expect(watcher.getByText(`Mano de ${name}`, { exact: true })).toBeVisible();
    };
    async function signal(name: string) {
      await press(button(sender.page, 'Hacer una seña'));
      await press(button(sender.page.getByRole('dialog'), name));
    }

    await chooseSeat('Beto mira');
    const pending = {
      teammate: await recordCues(teammate.page),
      opponentView: await recordCues(watcher),
    };
    await signal('Guiño derecho');
    await expect.poll(() => pending.teammate.jsonValue()).toContain('Ana guiña Guiño derecho');
    const delivery = teammate.updates.at(-1)!;
    expect(delivery.signals).toEqual([{ id: expect.any(Number), seat: 0, kind: 'perico' }]);
    const authorized = (await room.snapshot(1)).signals;
    await expect
      .poll(() => observer.updates.at(-1)?.sequence)
      .toBeGreaterThanOrEqual(delivery.sequence);
    expect(observer.updates.at(-1)!.signals).toEqual(authorized);
    if (authorized.length) {
      await expect
        .poll(() => pending.opponentView.jsonValue())
        .toContain('Ana guiña Guiño derecho');
    } else {
      expect(await pending.opponentView.jsonValue()).toEqual([]);
    }

    await expect(caption(watcher)).toHaveCount(0);
    const switched = await recordCues(watcher);
    await chooseSeat('Carla juega');
    expect(observer.updates.at(-1)).toMatchObject({ perspective: 2, signals: delivery.signals });
    await expect(button(watcher, 'Hacer una seña')).toHaveCount(0);
    await expect(button(watcher, 'Decir…')).toHaveCount(0);
    await press(button(watcher, 'Mirar las cartas'));
    const held = (await room.snapshot(2)).state!.hand.find(({ used }) => !used)!;
    await pickFromFan(watcher, held.card);

    await signal('Guiño izquierdo');
    await expect.poll(() => switched.jsonValue()).toEqual(['Ana guiña Guiño izquierdo']);
    expect(observer.commands).toEqual([]);
  } finally {
    await room.close();
  }
});
