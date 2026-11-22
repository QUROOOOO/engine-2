import { test, expect } from './fixtures';

test.describe('Flow 7: Responsive Layout', () => {
  test('layout stays usable and non-broken across desktop, tablet, and mobile', async ({ simPage }) => {
    // 1. Desktop (1280x800)
    await simPage.setViewportSize({ width: 1280, height: 800 });
    await expect(simPage.locator('#stage')).toBeVisible();
    await expect(simPage.locator('.rail')).toBeVisible();
    await expect(simPage.locator('.panel')).toBeVisible();

    // 2. Tablet (768x1024)
    await simPage.setViewportSize({ width: 768, height: 1024 });
    await expect(simPage.locator('#stage')).toBeVisible();
    await expect(simPage.locator('.panel')).toBeVisible();

    // 3. Mobile (375x812)
    await simPage.setViewportSize({ width: 375, height: 812 });
    await expect(simPage.locator('#stage')).toBeVisible();
    await expect(simPage.locator('.panel')).toBeVisible();
  });
});
