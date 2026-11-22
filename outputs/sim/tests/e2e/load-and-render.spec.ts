import { test, expect } from './fixtures';

test.describe('Flow 1: Load and Render', () => {
  test('app loads and renders the canvas without console or page errors', async ({ simPage }) => {
    const viewCanvas = simPage.locator('#view');
    await expect(viewCanvas).toBeVisible();

    // Verify live event status pill is populated
    const livePill = simPage.locator('#livePill');
    await expect(livePill).toBeVisible();
    await expect(livePill).not.toBeEmpty();

    // Verify loading overlay has disappeared
    const loading = simPage.locator('#loading');
    await expect(loading).toBeHidden();

    // Verify MET is running
    const met = simPage.locator('#met');
    await expect(met).toBeVisible();
    await expect(met).not.toHaveText('—');
  });
});
