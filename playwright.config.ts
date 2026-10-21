import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: [
        '**/card-motion.spec.ts',
        '**/card-sounds.spec.ts',
        '**/renderer.spec.ts',
        '**/burning.spec.ts',
        '**/vacant-rooms.spec.ts',
        '**/seats.spec.ts',
        '**/lobby-account.spec.ts',
        '**/privando.spec.ts',
        '**/vira-layout.spec.ts',
        '**/game-interaction.spec.ts',
      ],
    },
  ],
});
