import { expect, test } from '@playwright/test';
import type { Listing } from '../src/lib/protocol.js';

test('table filters combine with sorting and remain applied after refresh', async ({
  page,
}, testInfo) => {
  let listings: Listing[] = [
    {
      code: 'BETO-0001',
      host: 'Beto',
      players: 3,
      capacity: 4,
      cpuPlayers: 1,
      started: false,
      target: 24,
      florRequired: true,
    },
    {
      code: 'CAFE-0002',
      host: 'Café',
      players: 2,
      capacity: 4,
      started: false,
      target: 24,
      florRequired: true,
    },
    {
      code: 'ANAA-0003',
      host: 'Ana',
      players: 1,
      capacity: 2,
      started: false,
      target: 12,
      florRequired: false,
    },
    {
      code: 'ELEN-0004',
      host: 'Elena',
      players: 4,
      capacity: 4,
      cpuPlayers: 2,
      started: true,
      target: 24,
      florRequired: true,
    },
    {
      code: 'DORA-0005',
      host: 'Dora',
      players: 2,
      capacity: 2,
      started: true,
      target: 12,
      florRequired: false,
    },
  ];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/matches') await route.fulfill({ json: listings });
    else if (path === '/api/matches/events') {
      await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    } else await route.fulfill({ json: null });
  });
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  const names = page.locator('.table-row strong');
  const search = page.getByRole('searchbox', { name: 'Buscar por nombre' });
  const sort = page.getByLabel('Ordenar mesas');
  const hideFull = page.getByLabel('Ocultar mesas llenas');
  const hideCPU = page.getByLabel('Ocultar mesas con CPU');
  await expect(names).toHaveText([
    'Mesa de Beto',
    'Mesa de Café',
    'Mesa de Ana',
    'Mesa de Elena',
    'Mesa de Dora',
  ]);

  await sort.selectOption('players-asc');
  await expect(names).toHaveText([
    'Mesa de Ana',
    'Mesa de Café',
    'Mesa de Dora',
    'Mesa de Beto',
    'Mesa de Elena',
  ]);
  await sort.selectOption('players-desc');
  await expect(names).toHaveText([
    'Mesa de Elena',
    'Mesa de Beto',
    'Mesa de Café',
    'Mesa de Dora',
    'Mesa de Ana',
  ]);
  await hideFull.check();
  await expect(names).toHaveText(['Mesa de Beto', 'Mesa de Café', 'Mesa de Ana']);
  await hideCPU.check();
  await expect(names).toHaveText(['Mesa de Café', 'Mesa de Ana']);
  await search.fill('  CAFE  ');
  await expect(names).toHaveText(['Mesa de Café']);
  await expect(page.locator('.filter-count')).toHaveText('1 de 5 mesas');
  await search.fill('Nadie');
  await expect(names).toHaveCount(0);
  await expect(page.getByText('No hay mesas que coincidan.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(search).toHaveValue('');
  await expect(sort).toHaveValue('default');
  await expect(hideFull).not.toBeChecked();
  await expect(hideCPU).not.toBeChecked();
  await expect(names).toHaveCount(5);

  await hideFull.check();
  await hideCPU.check();
  await sort.selectOption('players-desc');
  listings = listings.map((table) =>
    table.host === 'Ana' ? { ...table, players: 2, started: true } : table,
  );
  await page.getByRole('button', { name: 'Actualizar mesas' }).click();
  await expect(names).toHaveText(['Mesa de Café']);
  await expect(hideFull).toBeChecked();
  await expect(hideCPU).toBeChecked();
  await expect(sort).toHaveValue('players-desc');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.table-filters')
    .screenshot({ path: testInfo.outputPath('table-filters.png') });
});
