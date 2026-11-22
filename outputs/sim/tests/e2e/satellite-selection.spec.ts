import { test, expect } from './fixtures';

test.describe('Flow 2: Satellite Selection', () => {
  test('selecting a satellite updates active target and detail panel', async ({ simPage }) => {
    // Select first object in the list
    const firstRow = simPage.locator('.obj').first();
    await expect(firstRow).toBeVisible();

    const nameText = await firstRow.locator('.nm').innerText();
    await firstRow.click();

    // Verify detail panel updates
    const selName = simPage.locator('#selName');
    await expect(selName).not.toHaveText('—');
    const panelName = await selName.innerText();
    expect(nameText).toContain(panelName);

    // Verify selection class is applied
    await expect(firstRow).toHaveClass(/sel/);
  });
});
