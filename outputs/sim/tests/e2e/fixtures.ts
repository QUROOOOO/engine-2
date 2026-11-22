import { test as base, expect, Page } from '@playwright/test';

type TestFixtures = {
  simPage: Page;
};

export const test = base.extend<TestFixtures>({
  simPage: async ({ page }, use) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => {
      // Ignore WebGL context failure warnings if software swiftshader takes a frame to bind
      if (!err.message.includes('ANGLE') && !err.message.includes('swiftshader')) {
        errors.push(err);
      }
    });

    await page.goto('/');

    // Wait for initial catalog propagation and loading overlay dismissal (state: hidden)
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: 15000 });
    await page.locator('#view').waitFor({ state: 'visible', timeout: 5000 });

    await use(page);

    expect(errors, `Uncaught console errors detected: ${errors.map((e) => e.message).join(', ')}`).toEqual([]);
  },
});

export { expect };
