import { expect, test } from '@playwright/test';

test('plot metric feedback settles despite fresh parent arrays, sets and clock callbacks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/fixtures/plot-feedback.html');
  await expect(page.locator('.uplot')).toBeVisible();
  const initialReports = await page.locator('#reports').textContent();
  await expect(page.locator('#catalog-stable')).toHaveText('true');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Unrelated parent update/ }).click();
  await expect(page.locator('#reports')).toHaveText(initialReports!);
  const overlay = page.locator('.u-over');
  await overlay.hover();
  await expect(page.locator('#reports')).toHaveText(initialReports!);
  await page.getByRole('button', { name: 'Toggle channel' }).click();
  await expect(page.getByText('No visible channels', { exact: true })).toBeVisible();
  await expect(page.locator('#reports')).toHaveText(String(Number(initialReports) + 1));
  await page.getByRole('button', { name: 'Toggle channel' }).click();
  await expect(page.getByText('No visible channels', { exact: true })).toBeHidden();
  await expect(page.locator('#reports')).toHaveText(String(Number(initialReports) + 2));
  expect(errors).toEqual([]);
});
