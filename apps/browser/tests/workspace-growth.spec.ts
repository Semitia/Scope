import { expect, test } from '@playwright/test';

test('workspace retains spare room and continues a drag while the pointer rests at the edge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?demo=1');
  const workspace = page.locator('.workspace');
  const panel = page.getByRole('region', { name: 'Scope 1', exact: true });
  const reserve = () => page.locator('.scope-grid').evaluate(grid => {
    const bottom = Math.max(...Array.from(grid.querySelectorAll('.scope-panel')).map(panel => panel.getBoundingClientRect().bottom));
    return grid.getBoundingClientRect().bottom - bottom;
  });
  expect(await reserve()).toBeGreaterThanOrEqual(400);
  const handle = (await panel.getByRole('button', { name: 'Move Scope 1', exact: true }).boundingBox())!;
  const rect = (await workspace.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, rect.y + rect.height - 10, { steps: 10 });
  await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(150);
  const firstY = Number(await panel.getAttribute('data-grid-y'));
  await expect.poll(async () => Number(await panel.getAttribute('data-grid-y'))).toBeGreaterThan(firstY + 1);
  expect(await reserve()).toBeGreaterThanOrEqual(400);
  await page.mouse.up();
  const committedY = await panel.getAttribute('data-grid-y');
  const stoppedAt = await workspace.evaluate(element => element.scrollTop);
  await page.waitForTimeout(150);
  expect(await workspace.evaluate(element => element.scrollTop)).toBe(stoppedAt);
  await page.reload();
  await expect(panel).toHaveAttribute('data-grid-y', committedY!);
  expect(await reserve()).toBeGreaterThanOrEqual(400);
});

test('resize grows past the viewport and Escape cancels the layout change', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?demo=1');
  const panel = page.getByRole('region', { name: 'Scope 1', exact: true });
  const originalHeight = await panel.getAttribute('data-grid-height');
  const handle = (await panel.getByRole('button', { name: 'Resize Scope 1', exact: true }).boundingBox())!;
  const workspace = page.locator('.workspace');
  const rect = (await workspace.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, rect.y + rect.height - 8, { steps: 10 });
  await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(150);
  await expect.poll(async () => Number(await panel.getAttribute('data-grid-height'))).toBeGreaterThan(Number(originalHeight) + 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(panel).toHaveAttribute('data-grid-height', originalHeight!);
});

test('horizontal reserve supports Shift-wheel and dragging beyond the original twelve columns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?demo=1');
  const workspace = page.locator('.workspace');
  const panel = page.getByRole('region', { name: 'Scope 1', exact: true });
  const initialWidth = (await panel.boundingBox())!.width;
  expect(await workspace.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(400);
  await page.locator('.u-over').hover({ position: { x: 200, y: 150 } });
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 180);
  await page.keyboard.up('Shift');
  await expect.poll(() => workspace.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await workspace.evaluate(element => element.scrollTop)).toBe(0);
  await workspace.evaluate(element => { element.scrollLeft = 0; });
  const handle = (await panel.getByRole('button', { name: 'Move Scope 1', exact: true }).boundingBox())!;
  const rect = (await workspace.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 8, 150, { steps: 10 });
  await expect.poll(async () => Number(await panel.getAttribute('data-grid-x'))).toBeGreaterThan(12);
  await page.mouse.up();
  const x = await panel.getAttribute('data-grid-x');
  expect((await panel.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
  await page.reload();
  await expect(panel).toHaveAttribute('data-grid-x', x!);
  expect((await panel.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
});
