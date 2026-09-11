import { expect, test } from '@playwright/test';

for (const visualStyle of ['compact', 'cards']) {
  test(`collapsed headers stay at 28px in ${visualStyle} layout`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(style => localStorage.setItem('debugscope.settings.v1', JSON.stringify({ visualStyle: style })), visualStyle);
    await page.goto('/?demo=1');
    for (const name of ['Scope 1', 'Programs & Channels']) {
      const panel = page.getByRole('region', { name, exact: true });
      const expanded = (await panel.boundingBox())!.height;
      await panel.getByRole('button', { name: `Collapse ${name}`, exact: true }).click();
      await expect.poll(async () => (await panel.boundingBox())!.height).toBe(28);
      await page.reload();
      await expect.poll(async () => (await panel.boundingBox())!.height).toBe(28);
      await panel.getByRole('button', { name: `Expand ${name}`, exact: true }).click();
      await expect.poll(async () => (await panel.boundingBox())!.height).toBe(expanded);
    }
  });
}
