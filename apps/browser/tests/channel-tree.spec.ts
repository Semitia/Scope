import { expect, test } from '@playwright/test';

test('nested channel groups keep independent collapse state and reveal search matches', async ({ page }) => {
  await page.goto('/tests/fixtures/channel-tree.html');
  const root = page.getByRole('button', { name: 'error channel group', exact: true });
  const child = page.getByRole('button', { name: 'error.position_vec channel group', exact: true });
  const grandchild = page.getByRole('button', { name: 'error.position_vec.raw channel group', exact: true });
  await expect(root.locator('b')).toHaveText('4');
  await expect(child.locator('span')).toHaveText('position_vec');
  await expect(child.locator('b')).toHaveText('2');
  expect((await grandchild.boundingBox())!.x).toBeGreaterThan((await child.boundingBox())!.x);
  await child.click();
  await expect(grandchild).toHaveCount(0);
  await expect(page.locator('[data-channel="error.angle"]')).toBeVisible();
  await root.click();
  await expect(child).toHaveCount(0);
  await root.click();
  await expect(child).toHaveAttribute('aria-expanded', 'false');
  await root.click();
  await page.getByRole('textbox', { name: 'Search' }).fill('raw.x');
  await expect(root.locator('b')).toHaveText('1');
  await expect(page.locator('[data-channel="error.position_vec.raw.x"]')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search' }).fill('');
  await expect(root).toHaveAttribute('aria-expanded', 'false');
});
