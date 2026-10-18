import { defineConfig, devices } from '@playwright/test';

// Pure layout regression: no app server, Docker, device or database is started.
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: 'device-panel-layout.spec.ts',
    workers: 1,
    reporter: 'list',
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
});
