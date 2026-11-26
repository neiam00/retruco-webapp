const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173').origin;

// Suites exercising DOM card/layout/flight behavior explicitly select that renderer.
export const classicTableState = {
  cookies: [],
  origins: [{ origin, localStorage: [{ name: 'retruco.table.mode', value: 'classic' }] }],
};
