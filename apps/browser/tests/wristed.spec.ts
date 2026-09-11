import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DEFAULT_WRISTED, parseWristedSettings, type Psi } from '../src/wristed/config';
import { wristedBindingGroups } from '../src/wristed/bindings';
import { POSE_LABELS } from '../src/wristed/config';
import { wristedFrames } from '../src/wristed/kinematics';

test('ported frames match PlotWristedSnake Python reference', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/wristed-python.json', import.meta.url), 'utf8'));
  for (const fixture of fixtures) {
    const frames = wristedFrames(fixture.psi as Psi, Math.PI / 6, DEFAULT_WRISTED.dimensions);
    for (const name of ['tip0', 'tip1', 'wrist1', 'wrist2', 'tipLeft', 'tipRight'] as const) {
      const actual = frames[name].elements;
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        expect(actual[col * 4 + row], `${name} [${row},${col}], psi=${fixture.psi}`).toBeCloseTo(fixture[name][row][col], 7);
      }
    }
  }
});

test('jaw opening is symmetric and invalid saved settings are rejected', () => {
  const d = DEFAULT_WRISTED.dimensions;
  const closed = wristedFrames([160, 0, 0, 0, 0, 0], 0, d);
  expect(closed.tipLeft.elements).toEqual(closed.tipRight.elements);
  const opened = wristedFrames([160, 0, 0, 0, 0, 0], Math.PI / 2, d);
  const separation = Math.hypot(...[12, 13, 14].map(i => opened.tipLeft.elements[i] - opened.tipRight.elements[i]));
  expect(separation).toBeCloseTo(2 * d.jawLength * Math.sin(Math.PI / 4), 10);
  expect(() => parseWristedSettings({ ...DEFAULT_WRISTED, dimensions: { ...d, radius: -1 } }, true)).toThrow();
});

test('instrument renders, binds live channels, pauses, and persists configuration', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Add panel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Wristed instrument' }).click();
  const panel = page.getByRole('region', { name: 'Wristed Instrument 1', exact: true });
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByRole('img', { name: 'Interactive wristed instrument 3D view' })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('MANUAL PREVIEW');
  const tip = panel.locator('.wristed-footer code');
  const original = await tip.textContent();
  await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
  await expect(page.locator('.wristed-pose-row label > span')).toHaveText(['l', 'φ', 'θ₁', 'δ₁', 'β₁', 'β₂', 'α']);
  await page.getByRole('spinbutton', { name: 'theta1 manual value' }).fill('1.2');
  await expect(tip).not.toHaveText(original!);
  await page.getByRole('combobox', { name: 'beta1 channel' }).selectOption('limit.0');
  await expect(panel.getByRole('status')).toHaveText('LIVE · 1/7 BOUND');
  await page.getByRole('button', { name: 'Close instrument settings' }).click();
  await page.getByRole('button', { name: /^Pause/ }).click();
  await expect(panel.getByRole('status')).toHaveText('PAUSED');
  const frozen = await tip.textContent();
  await page.waitForTimeout(500);
  await expect(tip).toHaveText(frozen!);
  await panel.getByRole('button', { name: 'Fit instrument in view' }).click();
  await panel.screenshot({ path: '../../artifacts/wristed-instrument-light.png' });
  await page.reload();
  await panel.scrollIntoViewIfNeeded();
  await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'theta1 manual value' })).toHaveValue('1.2');
  await expect(page.getByRole('combobox', { name: 'beta1 channel' })).toHaveValue('limit.0');
  await page.getByRole('button', { name: 'Close instrument settings' }).click();
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await panel.screenshot({ path: '../../artifacts/wristed-instrument-dark.png' });
  await panel.getByRole('button', { name: 'Collapse Wristed Instrument 1', exact: true }).click();
  await expect(panel.locator('canvas')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Expand Wristed Instrument 1', exact: true }).click();
  await expect(panel.locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('canvas owns mouse gestures without selecting text or scrolling the workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Add panel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Wristed instrument' }).click();
  const panel = page.getByRole('region', { name: 'Wristed Instrument 1', exact: true });
  const canvas = panel.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toBeVisible();
  await expect(panel.locator('.wristed-stage')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await expect(panel.locator('.wristed-stage')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await canvas.evaluate(element => {
    const panel = element.closest('.scope-panel')!;
    panel.setAttribute('data-leaked-events', '0');
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'contextmenu', 'wheel']) {
      panel.addEventListener(type, () => panel.setAttribute('data-leaked-events', String(Number(panel.getAttribute('data-leaked-events')) + 1)));
    }
  });
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  const before = await canvas.screenshot();
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 45, { steps: 10 });
  await page.mouse.up();
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  const beforePan = await canvas.screenshot();
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 130, y + 65, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  expect((await canvas.screenshot()).equals(beforePan)).toBe(false);
  const top = (await canvas.boundingBox())!.y;
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 240);
  await page.keyboard.up('Control');
  await expect(panel).toHaveAttribute('data-leaked-events', '0');
  expect((await canvas.boundingBox())!.y).toBe(top);
  expect(await canvas.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(false);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, box.y - 12, { steps: 8 });
  await page.mouse.up();
  await expect(panel).toHaveAttribute('data-leaked-events', '0');
  const released = await canvas.screenshot();
  await page.mouse.move(x + 50, y + 10);
  expect((await canvas.screenshot()).equals(released)).toBe(true);
  // The canvas guard must not cancel the adjacent form controls.
  await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'theta1 manual value' }).fill('0.9');
  await expect(page.getByRole('spinbutton', { name: 'theta1 manual value' })).toHaveValue('0.9');
});


test('instrument groups match by name and numeric order without mixing namespaces', () => {
  const left = POSE_LABELS.map(name => `left.${name}`);
  const right = POSE_LABELS.map(name => `right.${name}`);
  const vector = POSE_LABELS.map((_, i) => `pose.${i}`);
  const groups = wristedBindingGroups([...right, ...vector, ...left].reverse());
  expect(groups.find(g => g.id === 'named:left.')?.bindings).toEqual(left);
  expect(groups.find(g => g.id === 'named:right.')?.bindings).toEqual(right);
  expect(groups.find(g => g.id === 'vector:pose.')?.bindings).toEqual(vector);
  expect(wristedBindingGroups([...left.slice(0, 6), right[6]])).toEqual([]);
  expect(wristedBindingGroups([...vector, 'pose.7'])).toEqual([]);
  expect(wristedBindingGroups([...POSE_LABELS]).at(0)?.bindings).toEqual(POSE_LABELS);
  expect(wristedBindingGroups(['psi.0', 'psi.1', 'psi.2', 'psi.3', 'psi.4', 'psi.5', 'angle']).at(0)?.bindings)
    .toEqual(['psi.0', 'psi.1', 'psi.2', 'psi.3', 'psi.4', 'psi.5', 'angle']);
});

test('3D wheel requires Ctrl and ordinary wheel scrolls the workspace', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Add panel', exact: true }).click();
  await page.getByRole('menuitem', { name: /Wristed instrument/ }).click();
  const panel = page.getByRole('region', { name: 'Wristed Instrument 1', exact: true });
  const canvas = panel.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toBeVisible();
  const before = await canvas.screenshot();
  expect(await canvas.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', {
    deltaY: 240, bubbles: true, cancelable: true,
  })))).toBe(true);
  expect((await canvas.screenshot()).equals(before)).toBe(true);
  expect(await canvas.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', {
    deltaY: 240, ctrlKey: true, bubbles: true, cancelable: true,
  })))).toBe(false);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await canvas.hover();
  const workspace = page.locator('.workspace');
  const scrollTop = await workspace.evaluate(element => element.scrollTop);
  await page.mouse.wheel(0, 160);
  await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollTop);
});

test('rigid Blender model switches, articulates, resizes, and survives reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Add panel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Wristed instrument' }).click();
  const panel = page.getByRole('region', { name: 'Wristed Instrument 1', exact: true });
  const canvas = panel.locator('canvas');
  const toggle = panel.getByRole('button', { name: 'Use instrument model', exact: true });
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute('data-model-status', 'ready');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const tip = panel.locator('.wristed-footer code');
  const originalTip = await tip.textContent();
  const lines = await canvas.screenshot();
  await toggle.click();
  await expect(canvas).toHaveAttribute('data-appearance', 'model');
  await expect(tip).toHaveText(originalTip!);
  expect((await canvas.screenshot()).equals(lines)).toBe(false);
  await panel.screenshot({ path: '../../artifacts/wristed-model.png' });
  await panel.getByRole('button', { name: 'Focus wrist detail' }).click();
  await panel.screenshot({ path: '../../artifacts/wristed-model-detail.png' });
  await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'alpha manual value' }).fill('0');
  await page.getByRole('button', { name: 'Close instrument settings' }).click();
  const closed = await canvas.screenshot();
  await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'alpha manual value' }).fill('1.2');
  await page.getByRole('button', { name: 'Close instrument settings' }).click();
  // Opening only moves the jaws; the wrist XYZ must stay unchanged.
  await expect(tip).toHaveText(originalTip!);
  expect((await canvas.screenshot()).equals(closed)).toBe(false);
  await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'beta1 manual value' }).fill('0.7');
  await expect(tip).not.toHaveText(originalTip!);
  await page.getByText('Instrument dimensions', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Jaw length · mm', exact: true }).fill('15');
  await page.getByRole('button', { name: 'Close instrument settings' }).click();
  await page.reload();
  await canvas.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-appearance', 'model');
  await toggle.click();
  await expect(canvas).toHaveAttribute('data-appearance', 'lines');
  await toggle.click();
  await panel.getByRole('button', { name: 'Collapse Wristed Instrument 1', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  await panel.getByRole('button', { name: 'Expand Wristed Instrument 1', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-appearance', 'model');
  expect(errors).toEqual([]);
});

test('missing model keeps a usable line drawing with a visible explanation', async ({ page }) => {
  await page.route('**/instrument*.glb*', route =>
    route.request().resourceType() === 'script' ? route.continue() : route.abort());
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Add panel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Wristed instrument' }).click();
  const panel = page.getByRole('region', { name: 'Wristed Instrument 1', exact: true });
  await panel.scrollIntoViewIfNeeded();
  await panel.getByRole('button', { name: 'Use instrument model' }).click();
  await expect(panel.getByRole('note')).toContainText('模型加载失败');
  await expect(panel.locator('canvas')).toHaveAttribute('data-appearance', 'lines');
  await expect(panel.getByRole('status')).toHaveText('MANUAL PREVIEW');
});

test('older instrument settings default to lines and reject invalid appearance', () => {
  const { appearance: _, ...legacy } = DEFAULT_WRISTED;
  expect(parseWristedSettings(legacy, true).appearance).toBe('lines');
  expect(parseWristedSettings({ ...legacy, appearance: 'model' }, true).appearance).toBe('model');
  expect(() => parseWristedSettings({ ...legacy, appearance: 'invalid' }, true)).toThrow();
});
