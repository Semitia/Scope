import { expect, test } from '@playwright/test';

test('drag diagnostics are opt-in and export input, placement, render and completion samples', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?demo=1');
  const handle = page.getByRole('button', { name: 'Move Programs & Channels', exact: true });
  const drag = async () => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.up();
  };
  await drag();
  expect(await page.evaluate(() => window.debugscopeDragTraces)).toBeUndefined();

  await page.goto('/?demo=1&dragDebug=1');
  await drag();
  const traces = await page.evaluate(() => JSON.parse(JSON.stringify(window.debugscopeDragTraces)));
  expect(traces).toHaveLength(1);
  const samples = traces[0].samples;
  expect(samples.map((sample: { event: string }) => sample.event)).toEqual(expect.arrayContaining([
    'start', 'pointer', 'placement', 'preview', 'render', 'finish',
  ]));
  const placements = samples.filter((sample: { event: string }) => sample.event === 'placement');
  expect(placements[0].gridSnap).toBe(false);
  expect(placements.at(-1).gridSnap).toBe(true);
  expect(samples.find((sample: { event: string }) => sample.event === 'render').actualRect.width).toBeGreaterThan(0);
  expect(samples.at(-1).reason).toBe('commit');
  expect(samples.at(-1).pointerCount).toBeGreaterThan(0);
  expect(samples.at(-1).maxRenderDelayMs).toBeGreaterThanOrEqual(0);
  const sampleCount = samples.length;
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.debugscopeDragTraces![0].samples.length)).toBe(sampleCount);

  await page.goto('/?demo=1');
  await page.evaluate(() => localStorage.setItem('debugscope.drag-debug', '1'));
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.debugscopeDragTraces?.length)).toBe(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => window.debugscopeDragTraces![0].samples.at(-1)!.reason)).toBe('cancel');
});
