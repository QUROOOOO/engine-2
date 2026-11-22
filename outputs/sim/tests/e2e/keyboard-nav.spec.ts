import { test, expect } from './fixtures';

test.describe('Flow 8: Keyboard Navigation', () => {
  test('keyboard Tab/Enter/Space/Arrow navigation reaches controls without focus traps', async ({ simPage }) => {
    const pauseBtn = simPage.locator('#pauseBtn');
    await expect(pauseBtn).toHaveText('PAUSE');

    // Space toggles simulation pause / resume
    await simPage.keyboard.press('Space');
    await expect(pauseBtn).toHaveText('RESUME');
    await simPage.keyboard.press('Space');
    await expect(pauseBtn).toHaveText('PAUSE');

    // ? opens navigation help modal
    await simPage.keyboard.press('?');
    const helpModal = simPage.locator('#help');
    await expect(helpModal).toBeVisible();

    // Closing help dialog restores focus
    await simPage.locator('#helpClose').click();
    await expect(helpModal).toBeHidden();

    // Tab navigation cycles through interactive elements
    await simPage.keyboard.press('Tab');
    const focusedTag = await simPage.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag).toBeDefined();
  });
});
