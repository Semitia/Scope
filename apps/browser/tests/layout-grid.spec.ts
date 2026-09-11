import { expect, test } from '@playwright/test';

test('programs and channels can shrink to two columns and retain their width on reload', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/?demo=1');
  const panel = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const handle = (await panel.getByRole('button', { name: 'Resize Programs & Channels', exact: true }).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 500, y);
  await page.mouse.up();
  await expect(panel).toHaveAttribute('data-grid-width', '2');
  const rect = (await panel.boundingBox())!;
  expect(rect.width).toBeLessThan(190);
  const title = (await panel.locator('.panel-title-button').boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(rect.x + rect.width);
  await page.reload();
  await expect(panel).toHaveAttribute('data-grid-width', '2');
});

test('legacy edges migrate to one grid and stay aligned after resize, reload and viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('debugscope.scope-layouts.v1', JSON.stringify({
    __debugscope_workspace_template__: [
      { id: 'sources', type: 'sources', title: 'Programs & Channels', channelKeys: [], layout: { x: 0, y: 0, width: 3, height: 4 } },
      { id: 'upper', type: 'indicators', title: 'Upper', channelKeys: [], layout: { x: 3.13, y: 0.08, width: 8.02, height: 2.05 } },
      { id: 'lower', type: 'indicators', title: 'Lower', channelKeys: [], layout: { x: 7.07, y: 2.13, width: 4.11, height: 1.13 } },
    ],
  })));
  await page.reload();
  const upper = page.getByRole('region', { name: 'Upper', exact: true });
  const lower = page.getByRole('region', { name: 'Lower', exact: true });
  const assertGrid = async () => {
    const layouts = await page.locator('.scope-panel').evaluateAll((elements) => elements.map((element) => {
      const data = (element as HTMLElement).dataset;
      return { x: Number(data.gridX), y: Number(data.gridY), w: Number(data.gridWidth), h: Number(data.gridHeight) };
    }));
    for (const layout of layouts) {
      for (const edge of [layout.x, layout.y, layout.x + layout.w, layout.y + layout.h]) {
        expect(Number.isInteger(edge * 4)).toBe(true);
      }
    }
    for (let i = 0; i < layouts.length; i++) {
      for (const b of layouts.slice(i + 1)) {
        const a = layouts[i];
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
      }
    }
  };
  await expect(lower).toHaveAttribute('data-grid-x', '7');
  await assertGrid();
  for (const width of [1440, 1100, 1700]) {
    await page.setViewportSize({ width, height: 900 });
    const upperRect = (await upper.boundingBox())!;
    const lowerRect = (await lower.boundingBox())!;
    expect(Math.abs(upperRect.x + upperRect.width - lowerRect.x - lowerRect.width)).toBeLessThan(1);
    const handle = (await lower.getByRole('button', { name: 'Resize Lower', exact: true }).boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 5, y);
    await page.mouse.up();
    await assertGrid();
    await page.reload();
    await expect(lower).toHaveAttribute('data-grid-width', '4.25');
    await assertGrid();
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('debugscope.scope-layouts.v1')!));
  const lowerLayout = stored.__debugscope_workspace_template__.find((panel: { id: string }) => panel.id === 'lower').layout;
  expect(lowerLayout).toEqual({ x: 7, y: 2.25, width: 4.25, height: 1 });
});
