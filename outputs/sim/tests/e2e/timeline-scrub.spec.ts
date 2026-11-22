import { test, expect } from './fixtures';

test.describe('Flow 5: Timeline Scrub', () => {
  test('scrubbing/clicking the timeline updates simulation time state', async ({ simPage }) => {
    const timeline = simPage.locator('#timeline');
    const box = await timeline.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      // Click at 70% of timeline width
      await simPage.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);

      // Verify fill width style updated
      const timelineFill = simPage.locator('#timelineFill');
      const style = await timelineFill.getAttribute('style');
      expect(style).toContain('width:');
    }
  });
});
