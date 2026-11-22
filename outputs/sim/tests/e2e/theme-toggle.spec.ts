import { test, expect } from './fixtures';

test.describe('Flow 6: Theme Toggle', () => {
  test('toggling theme updates UI theme state cleanly', async ({ simPage }) => {
    const html = simPage.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    const themeBtn = simPage.locator('#themeBtn');
    await themeBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(themeBtn).toHaveText('DARK');

    await themeBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(themeBtn).toHaveText('LIGHT');
  });
});
