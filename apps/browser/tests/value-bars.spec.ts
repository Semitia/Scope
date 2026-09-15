import { expect, test } from '@playwright/test';

test('value bars keep equal track lengths, formatted readings and fit narrow panels', async ({ page }) => {
  await page.goto('/tests/fixtures/value-bars.html');
  await expect(page.locator('.value-bar-reading b')).toHaveText([
    '56.270', '-1.944', '1.033e-2', '-0.588', '-1.372e-2', '-1.347e-4',
  ]);
  await expect(page.locator('.value-bar-zero')).toHaveCount(0);
  for (const width of [440, 280, 180]) {
    await page.locator('#panel').evaluate((element, width) => { element.style.width = `${width}px`; }, width);
    const tracks = await page.locator('.value-bar-track').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().width));
    expect(Math.max(...tracks) - Math.min(...tracks)).toBeLessThan(1);
    expect(await page.locator('.value-bar-list').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    const readings = await page.locator('.value-bar-reading b').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().right));
    expect(Math.max(...readings) - Math.min(...readings)).toBeLessThan(1);
  }
});

test('range limits accept typed negatives and preserve values on invalid input or Escape', async ({ page }) => {
  await page.goto('/tests/fixtures/value-bars.html');
  for (const [edge, value] of [['minimum', '-90.5'], ['maximum', '-10.25']]) {
    const button = page.getByRole('button', { name: `Edit ${edge} for 0`, exact: true });
    await button.click();
    const input = page.getByRole('textbox', { name: `${edge[0].toUpperCase()}${edge.slice(1)} for 0`, exact: true });
    await input.fill('');
    await input.pressSequentially(value);
    await expect(input).toHaveValue(value);
    if (edge === 'minimum') await input.press('Enter');
    else await input.press('Tab');
    await expect(button).toHaveText(value);
    for (const invalid of ['', '-', 'abc']) {
      await button.click();
      await input.fill(invalid);
      await input.press('Tab');
      await expect(button).toHaveText(value);
    }
    await button.click();
    await input.fill('50');
    await input.press('Escape');
    await expect(button).toHaveText(value);
  }
});
