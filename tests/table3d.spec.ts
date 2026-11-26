import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Command, GameEvent, Snapshot } from '../src/lib/protocol.js';
import type { HeadPose } from '../src/lib/table3d/camera.js';
import { showTable, tableSnapshot } from './fixtures/table.js';

const scene = (page: Page) =>
  page.getByRole('application', {
    name: 'Vista desde tu asiento. Arrastra o usa las flechas para mirar.',
  });

const graphicsErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (/couldn't load texture|blob:.*violates/i.test(message.text())) errors.push(message.text());
  });
  return errors;
};

async function expectViewport(page: Page) {
  const view = scene(page);
  await expect(view).toBeVisible();
  const { width, height } = page.viewportSize()!;
  const bounds = await view.locator('canvas').boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, width, height });
  expect(
    await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - innerWidth,
      y: document.documentElement.scrollHeight - innerHeight,
    })),
  ).toEqual({ x: 0, y: 0 });
}

async function expectTappable(button: Locator) {
  const sameTarget = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!hit && element.contains(hit);
  });
  expect(sameTarget).toBe(true);
}

test('a mobile match fills the window as the screen rotates and resizes', async ({
  page,
  browserName,
}, { project }) => {
  test.skip(
    browserName !== 'chromium' || !project.use.hasTouch,
    'This case emulates touch and safe-area insets in Chromium.',
  );
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  await showTable(page, tableSnapshot(4, 1, false));
  await expectViewport(page);

  const mobile = await page.context().newCDPSession(page);
  const landscape = { width: 740, height: 360 };
  const insets = { top: 20, right: 40, bottom: 22, left: 40 };
  await page.setViewportSize(landscape);
  await mobile.send('Emulation.setSafeAreaInsetsOverride', { insets });
  await expectViewport(page);
  const menu = page.getByRole('button', { name: 'Detalles de la partida', exact: true });
  const inspect = page.getByRole('button', { name: 'Mirar las cartas' });
  const menuBounds = (await menu.boundingBox())!;
  const inspectBounds = (await inspect.boundingBox())!;
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(landscape.width - insets.right);
  expect(menuBounds.y).toBeGreaterThanOrEqual(insets.top);
  expect(inspectBounds.x).toBeGreaterThanOrEqual(insets.left);
  expect(inspectBounds.y + inspectBounds.height).toBeLessThanOrEqual(
    landscape.height - insets.bottom,
  );
  await expectTappable(menu);
  await expectTappable(inspect);

  await page.setViewportSize({ width: 740, height: 315 });
  await expectViewport(page);
  await expectTappable(inspect);
  await mobile.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  await page.setViewportSize({ width: 300, height: 700 });
  await expectViewport(page);
  await page.evaluate(() => window.scrollTo(1000, 1000));
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
  await menu.tap();
  await expect(page.getByRole('combobox', { name: 'Vista de la mesa' })).toBeVisible();
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /(?:^|,)\s*viewport-fit=cover(?:,|$)/,
  );
});

test('a fresh match follows the build default and can change renderer within that match', async ({
  page,
}) => {
  const classic = process.env.TEST_TABLE_DEFAULT === 'classic';
  const deckFaces = new Set<string>();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/cards\/card_.*\.webp$/.test(path)) deckFaces.add(path);
  });
  const table = tableSnapshot(4, 1, false);
  await showTable(page, table);
  if (classic) await expect(page.locator('.felt-table')).toBeVisible();
  else await expectViewport(page);
  await page.getByRole('button', { name: 'Detalles de la partida', exact: true }).click();
  const mode = page.getByRole('combobox', { name: 'Vista de la mesa', exact: true });
  await expect(mode).toHaveValue(classic ? 'classic' : '3d');
  if (!classic) expect(deckFaces.size).toBeLessThan(16);
  else await expect.poll(() => deckFaces.size).toBe(41);
  await mode.selectOption(classic ? '3d' : 'classic');
  if (classic) await expectViewport(page);
  else {
    await expect(scene(page)).toHaveCount(0);
    await expect.poll(() => deckFaces.size).toBe(41);
  }
  await expect(page.getByLabel('Marcador', { exact: true })).toContainText('3');
});

for (const size of [
  { width: 360, height: 740 },
  { width: 740, height: 360 },
]) {
  test(`match and tutorial fill ${size.width}×${size.height} with separate controls`, async ({
    page,
  }, { project }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
    const errors = graphicsErrors(page);
    const table = tableSnapshot(4, 1, false);
    table.state!.legal = [
      { type: 'call', kind: 'truco', amount: 3 },
      { type: 'play', card: 1 },
    ];
    let command: Command | undefined;
    await showTable(page, table, (received) => (command = received));
    await expectViewport(page);
    const menu = page.getByRole('button', { name: 'Detalles de la partida', exact: true });
    const score = await page.getByLabel('Marcador', { exact: true }).boundingBox();
    expect(score!.x + score!.width).toBeLessThan((await menu.boundingBox())!.x);
    const look = page.getByRole('button', { name: 'Mirar las cartas' });
    await expectTappable(menu);
    await expectTappable(look);
    await expectTappable(page.getByRole('button', { name: 'Decir…' }));
    const truco = page.getByRole('button', { name: 'Truco', exact: true });
    await expectTappable(truco);
    if (project.use.hasTouch) await truco.tap();
    else await truco.click();
    await expect.poll(() => command).toEqual({ type: 'call', kind: 'truco', amount: 3 });
    await page.unroute('**/api/**');
    await page.goto('/aprender');
    await expectViewport(page);
    const coach = page.getByRole('button', { name: 'Paso 1 de 10' });
    await expectTappable(coach);
    await coach.click();
    await expect(coach).toHaveAttribute('aria-expanded', 'false');
    await expectTappable(page.getByRole('button', { name: 'Mirar las cartas' }));
    await expect(page.getByRole('region', { name: 'Mesa de práctica' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('WebGL context loss falls back within the same match and preserves card input', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const table = tableSnapshot(2, 1, false);
  table.state!.legal = [{ type: 'play', card: 1 }];
  let command: Command | undefined;
  await showTable(page, table, (received) => (command = received));
  await expectViewport(page);
  await scene(page)
    .locator('canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('This browser cannot exercise WebGL context loss.');
      extension.loseContext();
    });
  await expect(scene(page)).toHaveCount(0);
  const card = page.getByRole('button', { name: '2 de espadas' });
  await expect(card).toBeEnabled();
  await card.click();
  expect(command).toEqual({ type: 'play', card: 1, declaration: '' });
});

test('a new canto focuses its caller and manual look interrupts while reply remains legal', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const table = tableSnapshot(4, 1, false);
  const poses: HeadPose[] = [];
  let command: Command | undefined;
  const update = await showTable(
    page,
    table,
    (received) => (command = received),
    (pose) => {
      if (pose) poses.push(pose);
    },
  );
  await expectViewport(page);
  expect(await page.getByRole('status').filter({ hasText: 'No quiero' }).count()).toBe(0);
  const next = structuredClone(table);
  next.state!.revision++;
  next.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
  next.state!.legal = [{ type: 'respond', kind: 'accept' }];
  next.events!.push({ id: 5, hand: 1, event: { type: 'call', seat: 3, kind: 'truco', amount: 3 } });
  update(next);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 3 Truco' })).toBeVisible();
  await expect.poll(() => poses.at(-1)?.yaw ?? 0).toBeGreaterThan(32);

  const view = scene(page);
  const bounds = (await view.boundingBox())!;
  await page.mouse.move(bounds.width / 2, bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.width / 2 + 230, bounds.height / 2, { steps: 7 });
  await page.mouse.up();
  await expect.poll(() => poses.at(-1)?.yaw ?? 0).toBeLessThan(-10);
  const manualView = poses.at(-1)!;
  const reply = page.getByRole('button', { name: 'Quiero', exact: true });
  await expectTappable(reply);
  await reply.click();
  expect(command).toEqual({ type: 'respond', kind: 'accept' });
  const answered = withCanto(next, { type: 'respond', seat: 0, kind: 'accept', canto: 'truco' });
  answered.state!.pending = undefined;
  answered.state!.legal = [];
  const afterDrag = poses.length;
  update(answered);
  await expect.poll(() => poses.length).toBeGreaterThan(afterDrag + 3);
  expect(poses.slice(afterDrag)).toEqual(
    Array.from({ length: poses.length - afterDrag }, () => manualView),
  );
});

function withCanto(snapshot: Snapshot, event: GameEvent['event']) {
  const next = structuredClone(snapshot);
  next.sequence++;
  next.state!.revision++;
  (next.events ??= []).push({
    id: (next.events.at(-1)?.id ?? 0) + 1,
    hand: next.state!.handNumber,
    event,
  });
  return next;
}

test('the camera returns to the hand while a canto is pending and after its reply', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const table = tableSnapshot(4, 1, false);
  const poses: HeadPose[] = [];
  const update = await showTable(page, table, undefined, (pose) => {
    if (pose) poses.push(pose);
  });
  await expectViewport(page);
  await page.getByRole('button', { name: 'Mirar las cartas' }).click();
  await expect.poll(() => poses.at(-1)?.pitch ?? 0).toBeLessThan(-55);
  const handView = poses.at(-1)!;

  const called = withCanto(table, { type: 'call', seat: 3, kind: 'truco', amount: 3 });
  called.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
  called.state!.legal = [{ type: 'respond', kind: 'accept' }];
  update(called);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 3 Truco' })).toBeVisible();
  await expect.poll(() => poses.at(-1)?.yaw ?? 0).toBeGreaterThan(32);
  await expect.poll(() => poses.at(-1), { timeout: 3500 }).toEqual(handView);
  await expect(page.getByRole('button', { name: 'Quiero', exact: true })).toBeEnabled();

  const raised = withCanto(called, {
    type: 'respond',
    seat: 2,
    kind: 'raise',
    canto: 'truco',
    amount: 6,
  });
  raised.state!.pending = { kind: 'truco', caller: 0, value: 6, previous: 3, terminal: false };
  raised.state!.legal = [];
  update(raised);
  await expect(
    page.getByRole('status').filter({ hasText: 'CPU 2 Quiero y retruco' }),
  ).toBeVisible();
  await expect.poll(() => poses.at(-1)?.pitch ?? -100).toBeGreaterThan(-22);

  const interrupted = withCanto(raised, { type: 'call', seat: 1, kind: 'envido' });
  interrupted.state!.suspended = raised.state!.pending;
  interrupted.state!.pending = {
    kind: 'envido',
    caller: 1,
    value: 2,
    previous: 1,
    terminal: false,
  };
  update(interrupted);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 1 Envido' })).toBeVisible();
  await expect.poll(() => poses.at(-1)?.yaw ?? 0).toBeLessThan(-28);

  const resumed = withCanto(interrupted, {
    type: 'respond',
    seat: 2,
    kind: 'decline',
    canto: 'envido',
  });
  resumed.state!.pending = interrupted.state!.suspended;
  resumed.state!.suspended = undefined;
  update(resumed);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 2 No quiero' })).toBeVisible();
  await expect.poll(() => poses.at(-1), { timeout: 3500 }).toEqual(handView);

  const replied = withCanto(resumed, { type: 'respond', seat: 3, kind: 'accept', canto: 'truco' });
  replied.state!.pending = undefined;
  replied.state!.trucoValue = 6;
  replied.state!.legal = [];
  update(replied);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 3 Quiero' })).toBeVisible();
  await expect.poll(() => poses.at(-1)?.yaw ?? 0).toBeGreaterThan(30);
  await expect.poll(() => poses.at(-1), { timeout: 3500 }).toEqual(handView);
});

test('disabling automatic canto focus stops current and later turns with blocked storage', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('retruco.table.mode', '3d');
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'retruco.table.autoFocusCantos') throw new DOMException('Unavailable');
      save.call(this, key, value);
    };
  });
  const table = tableSnapshot(4, 1, false);
  const poses: HeadPose[] = [];
  const update = await showTable(page, table, undefined, (pose) => {
    if (pose) poses.push(pose);
  });
  await expectViewport(page);
  await page.getByRole('button', { name: 'Detalles de la partida', exact: true }).click();
  const autoFocus = page.getByRole('switch', { name: 'Enfocar al jugador que canta' });
  await expect(autoFocus).toBeChecked();

  const called = withCanto(table, { type: 'call', seat: 3, kind: 'truco', amount: 3 });
  called.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
  update(called);
  await expect.poll(() => poses.at(-1)?.yaw ?? 0, { intervals: [20, 40, 80] }).toBeGreaterThan(17);
  await autoFocus.uncheck();
  await expect(autoFocus).not.toBeChecked();
  const disabled = poses.length;
  await expect.poll(() => poses.length).toBeGreaterThan(disabled);
  const stoppedAt = poses.at(-1)!;
  expect(stoppedAt.yaw).toBeGreaterThan(12);
  await page.keyboard.press('Escape');
  await expect(autoFocus).toBeHidden();

  const replied = withCanto(called, { type: 'respond', seat: 2, kind: 'accept', canto: 'truco' });
  replied.state!.pending = undefined;
  replied.state!.trucoValue = 3;
  const afterDisable = poses.length;
  update(replied);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 2 Quiero' })).toBeVisible();
  await expect.poll(() => poses.length).toBeGreaterThan(afterDisable + 3);
  expect(poses.slice(afterDisable)).toEqual(
    Array.from({ length: poses.length - afterDisable }, () => stoppedAt),
  );
});

const portraitGame = { width: 360, height: 740 };
const portraitFan = { columns: [120, 180, 240], y: 462 };

async function showPortraitFan(page: Page) {
  await page.setViewportSize(portraitGame);
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const table = tableSnapshot(2, 1, false);
  table.state!.hand.forEach((card) => (card.used = false));
  table.state!.legal = [0, 1, 2].map((card) => ({ type: 'play', card }));
  const commands: Command[] = [];
  const poses: HeadPose[] = [];
  await showTable(
    page,
    table,
    (received) => commands.push(received),
    (pose) => {
      if (pose) poses.push(pose);
    },
  );
  await expectViewport(page);
  const card = { x: portraitFan.columns[2], y: portraitFan.y };
  return { card, commands, poses };
}

async function showTouchFan(page: Page) {
  await page.clock.install();
  const fan = await showPortraitFan(page);
  await page.getByRole('button', { name: 'Mirar las cartas' }).tap();
  await expect.poll(() => fan.poses.at(-1)?.pitch ?? 0).toBeLessThan(-55);
  const pauseAt = await page.evaluate(() => Date.now() + 1000);
  await page.clock.pauseAt(pauseAt);

  const nextPose = async () => {
    const previous = fan.poses.length;
    // A subsequent pose confirms the earlier gesture has reached the match socket.
    await page.clock.fastForward(450);
    await expect.poll(() => fan.poses.length).toBeGreaterThan(previous);
    return fan.poses.at(-1)!;
  };

  const session = await page.context().newCDPSession(page);
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    ...touchPoints: { x: number; y: number; id: number }[]
  ) => {
    const timestamp = await page.evaluate(() => Date.now() / 1000);
    await session.send('Input.dispatchTouchEvent', { type, touchPoints, timestamp });
  };
  return { ...fan, card: { ...fan.card, id: 0 }, nextPose, touch };
}

test('a quick one-finger swipe turns the camera without playing the card underneath', async ({
  page,
  browserName,
}, { project }) => {
  test.skip(
    browserName !== 'chromium' || !project.use.hasTouch,
    'This case uses Chromium touch input.',
  );
  const { card, commands, poses, nextPose, touch } = await showTouchFan(page);
  await page.mouse.move(card.x, card.y);
  await expect(scene(page).locator('.held-card-label')).toHaveText('3 de espadas');
  const before = await nextPose();
  const moved = { ...card, x: card.x + 65 };
  await touch('touchStart', card);
  await page.clock.fastForward(16);
  await touch('touchMove', moved);
  // Keep the finger down and elapsed time below the old 260 ms hold threshold.
  await page.clock.fastForward(144);
  await expect.poll(() => poses.at(-1)?.yaw).toBeLessThan(before.yaw - 10);

  await touch('touchMove', card);
  await touch('touchEnd');
  expect(await nextPose()).toEqual(before);
  expect(commands).toEqual([]);
});

test('releasing a held or interrupted touch leaves the card available for a single tap', async ({
  page,
  browserName,
}, { project }) => {
  test.skip(
    browserName !== 'chromium' || !project.use.hasTouch,
    'This case uses Chromium touch input.',
  );
  const { card, commands, nextPose, touch } = await showTouchFan(page);
  await touch('touchStart', card);
  await nextPose();
  await touch('touchEnd');
  await nextPose();
  expect(commands).toEqual([]);

  const menu = page.getByRole('button', { name: 'Detalles de la partida', exact: true });
  const { x, y, width, height } = (await menu.boundingBox())!;
  const secondFinger = { x: x + width / 2, y: y + height / 2, id: 1 };
  await touch('touchStart', card);
  await touch('touchStart', card, secondFinger);
  await touch('touchEnd');
  await nextPose();
  expect(commands).toEqual([]);

  await touch('touchStart', card);
  await nextPose();
  await touch('touchCancel');
  await nextPose();
  expect(commands).toEqual([]);

  await touch('touchStart', card);
  await touch('touchEnd');
  await nextPose();
  expect(commands).toEqual([{ type: 'play', card: 2, declaration: '' }]);
});

test('the portrait first-person fan stays still under mouse hover and plays the intended card once', async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.hasTouch, 'This case exercises mouse hover and selection.');
  const { card, commands } = await showPortraitFan(page);
  await page.getByRole('button', { name: 'Mirar las cartas' }).click();
  const captureFan = () =>
    page.screenshot({
      clip: { x: 20, y: 350, width: 320, height: 210 },
      style:
        '.first-person-table > :not(canvas), .table-layer, .hand-area, .social-controls { visibility: hidden !important; }',
    });
  let still: Buffer | undefined;
  await expect
    .poll(async () => {
      const current = await captureFan();
      const stable = !!still?.equals(current);
      still = current;
      return stable;
    })
    .toBe(true);
  const labelView = scene(page).locator('.held-card-label');
  for (const index of [0, 1, 2, 1, 0, 2]) {
    const x = portraitFan.columns[index];
    const label = `${index + 1} de espadas`;
    await page.mouse.move(x, card.y, { steps: 6 });
    await expect(labelView).toHaveText(label);
    expect((await captureFan()).equals(still!)).toBe(true);
  }
  await page.mouse.move(0, 741);
  await expect(labelView).toHaveCount(0);
  expect(commands).toEqual([]);
  await page.mouse.click(card.x, card.y);
  await expect.poll(() => commands).toEqual([{ type: 'play', card: 2, declaration: '' }]);
});

async function visibleCardBounds(page: Page, labels: string[], step?: number) {
  return scene(page)
    .locator('canvas')
    .evaluate(
      async (canvas, { wanted, spacing }) => {
        const bounds: Record<
          string,
          { left: number; right: number; top: number; bottom: number; count: number }
        > = {};
        const rect = canvas.getBoundingClientRect();
        const step = spacing ?? (rect.width > 900 ? 18 : 9);
        for (let y = Math.round(rect.height * 0.25); y < rect.height * 0.92; y += step) {
          for (let x = step / 2; x < rect.width; x += step) {
            if (document.elementFromPoint(x, y) !== canvas) continue;
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: x,
                clientY: y,
                pointerType: 'mouse',
                bubbles: true,
              }),
            );
            await Promise.resolve();
            await Promise.resolve();
            const label = canvas.parentElement
              ?.querySelector('.held-card-label')
              ?.textContent?.trim();
            if (!label || !wanted.includes(label)) continue;
            const card = (bounds[label] ??= { left: x, right: x, top: y, bottom: y, count: 0 });
            card.left = Math.min(card.left, x);
            card.right = Math.max(card.right, x);
            card.top = Math.min(card.top, y);
            card.bottom = Math.max(card.bottom, y);
            card.count++;
          }
        }
        return bounds;
      },
      { wanted: labels, spacing: step },
    );
}

test('short landscape leaves the held cards selectable above the burn controls', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 740, height: 320 });
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const table = tableSnapshot(4, 3, false);
  const game = table.state!;
  game.hand[1].card = { suit: 'cups', number: 11 };
  game.hand[2].card = { suit: 'coins', number: 7 };
  game.holding = { envido: 20, flor: 0, receta: false };
  game.legal = [
    { type: 'burn', card: 1 },
    { type: 'burn', card: 2 },
    { type: 'call', kind: 'truco', amount: 3 },
  ];
  const commands: Command[] = [];
  await showTable(page, table, (command) => commands.push(command));
  await expectViewport(page);

  await page.getByRole('button', { name: 'Mirar las cartas' }).click();
  await page.getByRole('button', { name: 'Quemar carta', exact: true }).click();
  const dock = page.getByRole('region', { name: 'Tu mano' });
  await expect(dock.getByRole('status')).toHaveText(
    'Elige una carta para quemarla y pasar el turno.',
  );
  const dockTop = (await dock.boundingBox())!.y;
  const labels = ['11 de copas', '7 de oros'];
  let hits: Awaited<ReturnType<typeof visibleCardBounds>> = {};
  await expect
    .poll(async () => {
      hits = await visibleCardBounds(page, labels, 6);
      return labels.every((name) => hits[name] && dockTop - hits[name].top >= 24);
    })
    .toBe(true);
  expect(commands).toEqual([]);

  const target = hits[labels[0]];
  const x = (target.left + target.right) / 2;
  const y = (target.top + Math.min(target.bottom, dockTop - 1)) / 2;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect.poll(() => commands).toEqual([{ type: 'burn', card: 1, declaration: '' }]);
});

for (const players of [2, 4]) {
  test(`the ${players}-seat vira ends in the same dealer-side spot after the deal and reconnect`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 945, height: 656 });
    await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
    const dealt = tableSnapshot(players, players / 2, false);
    dealt.state!.vira = { suit: 'cups', number: 6 };
    dealt.state!.round = 0;
    dealt.state!.hand.forEach((entry) => (entry.used = false));
    dealt.state!.seats.forEach((entry) => {
      entry.remaining = 3;
      entry.plays = [];
    });
    dealt.sequence++;
    dealt.state!.revision++;
    const cutting = structuredClone(dealt);
    cutting.sequence--;
    cutting.state!.revision--;
    cutting.state!.phase = 'cutting';
    cutting.state!.turn = (dealt.state!.dealer + players - 1) % players;
    cutting.state!.vira = undefined;
    cutting.state!.hand = [];
    const update = await showTable(page, cutting);
    await expectViewport(page);
    update(dealt);
    const locateVira = async () => (await visibleCardBounds(page, ['6 de copas'], 9))['6 de copas'];
    await expect.poll(async () => (await locateVira())?.count ?? 0).toBeGreaterThan(12);
    const afterDeal = await locateVira();
    expect(afterDeal.right).toBeLessThan(945 * 0.43);

    const synced = structuredClone(dealt);
    synced.state!.scores[1] = 7;
    await update.disconnect(synced);
    await expect(page.getByLabel('Marcador', { exact: true })).toContainText('7');
    await expect.poll(locateVira).toEqual(afterDeal);
  });
}

for (const size of [
  { width: 1440, height: 960 },
  { width: 945, height: 656 },
  { width: 360, height: 740 },
]) {
  test(`first-person hand and tabletop stay readable after plays at ${size.width}×${size.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      !!testInfo.project.use.hasTouch,
      'This case measures real pointer regions and the touch selection case covers mobile taps.',
    );
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
    const table = tableSnapshot(4, 0, false);
    const game = table.state!;
    game.vira = { suit: 'cups', number: 6 };
    game.hand = [
      { index: 0, card: { suit: 'cups', number: 11 }, used: false },
      { index: 1, card: { suit: 'coins', number: 7 }, used: true },
      { index: 2, card: { suit: 'spades', number: 1 }, used: false },
    ];
    game.seats[0].plays = [
      { present: true, card: game.hand[1].card, concealed: false, burned: false },
    ];
    game.legal = [
      { type: 'play', card: 0 },
      { type: 'play', card: 2 },
    ];
    const commands: Command[] = [];
    const update = await showTable(page, table, (received) => commands.push(received));
    await expectViewport(page);
    await page.getByRole('button', { name: 'Mirar las cartas' }).click();
    const labels = ['11 de copas', '1 de espadas', '7 de oros', '6 de copas'];
    let hits: Awaited<ReturnType<typeof visibleCardBounds>> = {};
    await expect
      .poll(async () => {
        const current = await visibleCardBounds(page, labels);
        const settled =
          Object.keys(current).length === labels.length &&
          JSON.stringify(current) === JSON.stringify(hits);
        hits = current;
        return settled;
      })
      .toBe(true);
    const [left, right, played, vira] = labels.map((label) => hits[label]);
    const width = (right.right - left.left) / size.width;
    const top = Math.min(left.top, right.top);
    expect(width).toBeLessThan(size.width > 900 ? 0.45 : 0.7);
    expect(top / size.height).toBeGreaterThan(size.width === 1440 ? 0.53 : 0.45);
    expect((left.left + right.right) / (2 * size.width)).toBeCloseTo(0.5, 1);
    // Slanted edges can meet the same sample row without covering a meaningful part of a face.
    expect(played.bottom).toBeLessThanOrEqual(top);
    expect(vira.left).toBeGreaterThan(right.right);
    const readableFaceSamples = size.width === 945 ? 10 : 22;
    expect(played.count).toBeGreaterThan(readableFaceSamples);
    expect(vira.count).toBeGreaterThan(size.width > 900 ? 6 : 12);

    await page.mouse.click((left.left + left.right) / 2, (left.top + left.bottom) / 2);
    await expect.poll(() => commands).toEqual([{ type: 'play', card: 0, declaration: '' }]);
    const next = structuredClone(table);
    next.state!.revision++;
    next.state!.round = 2;
    next.state!.hand[0].used = true;
    next.state!.seats[0].remaining = 1;
    next.state!.seats[0].plays.push({
      present: true,
      card: game.hand[0].card,
      concealed: false,
      burned: false,
    });
    next.events!.push({ id: 5, hand: 1, event: { type: 'play', seat: 0 } });
    update(next);
    await expect
      .poll(async () => {
        const after = await visibleCardBounds(page, labels);
        const last = after['1 de espadas'];
        const first = after['7 de oros'];
        const second = after['11 de copas'];
        return (
          !!last &&
          !!first &&
          !!second &&
          Math.abs((last.left + last.right) / (2 * size.width) - 0.5) < 0.055 &&
          Math.max(first.bottom, second.bottom) <= last.top
        );
      })
      .toBe(true);
  });
}

test('reduced motion captions a fresh canto and a newly visible signal without turning the camera', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const table = tableSnapshot(4, 1, false);
  table.signals = [{ id: 1, seat: 1, kind: 'perico' }];
  const poses: HeadPose[] = [];
  const update = await showTable(page, table, undefined, (pose) => {
    if (pose) poses.push(pose);
  });
  await expectViewport(page);
  await expect(page.getByText('Guiño derecho', { exact: true })).toHaveCount(0);

  const incoming = structuredClone(table);
  incoming.state!.revision++;
  incoming.events!.push({
    id: 5,
    hand: 1,
    event: { type: 'call', seat: 3, kind: 'truco', amount: 3 },
  });
  update(incoming);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 3 Truco' })).toBeVisible();
  await expect.poll(() => poses.length).toBeGreaterThan(1);
  expect(poses.every(({ yaw }) => yaw === 0)).toBe(true);

  const withSignal = structuredClone(incoming);
  withSignal.signals.push({ id: 6, seat: 2, kind: 'perica' });
  update(withSignal);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 2 Guiño izquierdo' })).toBeVisible();
  await expect(page.getByText('Guiño derecho', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 2 Guiño izquierdo' })).toHaveCount(
    0,
  );
  update(withSignal);
  await expect(page.getByRole('status').filter({ hasText: 'CPU 2 Guiño izquierdo' })).toHaveCount(
    0,
  );
});

test('reconnect displays the latest board without replaying past 3D cues', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const table = tableSnapshot(4, 1, false);
  const poses: HeadPose[] = [];
  const update = await showTable(page, table, undefined, (pose) => {
    if (pose) poses.push(pose);
  });
  await expectViewport(page);
  await expect.poll(() => poses.length).toBeGreaterThan(0);

  const recovered = structuredClone(table);
  recovered.state!.revision++;
  recovered.state!.scores[1] = 7;
  recovered.events!.push({
    id: 5,
    hand: 1,
    event: { type: 'call', seat: 3, kind: 'truco', amount: 3 },
  });
  recovered.signals = [{ id: 6, seat: 3, kind: 'perica' }];
  const beforeReconnect = poses.length;
  await update.disconnect(recovered);
  await expect(page.getByLabel('Marcador', { exact: true })).toContainText('7');
  await expect.poll(() => poses.length).toBeGreaterThan(beforeReconnect + 1);
  await expect(
    page.getByRole('status').filter({ hasText: /CPU 3 (Truco|Guiño izquierdo)/ }),
  ).toHaveCount(0);
  expect(poses.slice(beforeReconnect).every(({ yaw }) => yaw === 0)).toBe(true);
});
