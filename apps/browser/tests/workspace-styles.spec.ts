import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const style = { color: '#a12bc3', lineCurve: 'stepped', linePattern: 'dashdot', lineWidth: 3, opacity: .4 };
async function exportFile(page: Page) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace', exact: true }).click();
  const path = await (await pending).path();
  return JSON.parse(await readFile(path!, 'utf8'));
}
async function importFile(page: Page, config: unknown) {
  await page.getByLabel('Import workspace configuration').setInputFiles({
    name: 'styles.workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)),
  });
}
async function assertStyle(page: Page, label: string) {
  await page.getByRole('button', { name: `Style ${label}`, exact: true }).click();
  await expect(page.getByLabel(`Color for ${label}`, { exact: true })).toHaveValue(style.color);
  await expect(page.getByLabel(`Curve for ${label}`, { exact: true })).toHaveText('Stepped');
  await expect(page.getByLabel(`Stroke for ${label}`, { exact: true })).toHaveText('Dash-dot');
  await expect(page.getByLabel(`Width for ${label}`, { exact: true })).toHaveValue('3');
  await expect(page.getByLabel(`Opacity for ${label}`, { exact: true })).toHaveValue('0.4');
}

test('workspace styles round-trip in a clean browser under a different source identity', async ({ page, browser }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Style Target', exact: true }).click();
  await page.getByLabel('Color for Target', { exact: true }).fill(style.color);
  await page.getByLabel('Curve for Target', { exact: true }).click();
  await page.getByRole('option', { name: 'Stepped', exact: true }).click();
  await page.getByLabel('Stroke for Target', { exact: true }).click();
  await page.getByRole('option', { name: 'Dash-dot', exact: true }).click();
  await page.getByLabel('Width for Target', { exact: true }).selectOption('3');
  await page.getByLabel('Opacity for Target', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Close style editor', exact: true }).click();
  const config = await exportFile(page);
  expect(config.channelStyles['controller.target']).toEqual(style);
  // Default styles must travel too, otherwise discovery order changes their colors.
  expect(Object.keys(config.channelStyles)).toHaveLength(7);
  expect(config.channelStyles['controller.speed'].color).toMatch(/^#[\da-f]{6}$/i);
  const context = await browser.newContext();
  try {
    const restored = await context.newPage();
    await restored.routeWebSocket('**/api/ws', socket => {
      socket.send(JSON.stringify({ type: 'catalog', sources: [{ id: 91, name: 'different-program',
        programKey: 'different-program', active: true, channels: [
          { sourceId: 91, key: 'controller.target', valueType: 'FLOAT64', lastValue: 1, lastSeen: 1 },
        ] }] }));
    });
    await restored.goto('/');
    await expect(restored.getByRole('button', { name: 'Style Target', exact: true })).toBeVisible();
    await restored.getByRole('button', { name: 'Open settings', exact: true }).click();
    await importFile(restored, config);
    await expect(restored.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('status')).toContainText('Imported');
    await restored.getByRole('button', { name: 'Close settings panel', exact: true }).click();
    await assertStyle(restored, 'Target');
    await restored.reload();
    await assertStyle(restored, 'Target');
    await restored.getByRole('button', { name: 'Close style editor', exact: true }).click();
    const reexport = await exportFile(restored);
    expect(reexport.channelStyles).toEqual(config.channelStyles); // Includes temporarily offline channels.
  } finally { await context.close(); }
});

test('legacy imports preserve local styles and malformed styles reject the whole import', async ({ page }) => {
  await page.goto('/?demo=1');
  const config = await exportFile(page);
  config.channelStyles['controller.target'] = style;
  await importFile(page, config);
  const legacy = { ...config }; delete legacy.channelStyles;
  await importFile(page, legacy);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('status')).toContainText('Imported');
  const before = await page.evaluate(() => [localStorage.getItem('debugscope.channel-styles.v1'), localStorage.getItem('debugscope.scope-layouts.v1')]);
  for (const bad of [{ ...style, opacity: 2 }, { ...style, color: 'bad' }, { ...style, linePattern: 'invalid' }]) {
    await importFile(page, { ...config, panels: config.panels.map((p: object) => ({ ...p, title: 'Should not import' })),
      channelStyles: { 'controller.target': bad } });
    await expect(page.getByRole('alert')).toContainText('Invalid channel style');
    expect(await page.evaluate(() => [localStorage.getItem('debugscope.channel-styles.v1'), localStorage.getItem('debugscope.scope-layouts.v1')])).toEqual(before);
  }
  await page.getByRole('button', { name: 'Close settings panel', exact: true }).click();
  await assertStyle(page, 'Target');
});

test('manual waveform Y bounds survive export, reload, and import', async ({ page }) => {
  await page.goto('/?demo=1');
  const stage = page.locator('.plot-stage').first();
  await expect(stage).toHaveAttribute('data-y-min');
  await page.getByLabel('Y axis mode for Scope 1').selectOption('manual');
  const before = await stage.getAttribute('data-y-min');
  await page.locator('.u-over').first().dispatchEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 250 });
  await expect(stage).not.toHaveAttribute('data-y-min', before!);
  const range = { min: Number(await stage.getAttribute('data-y-min')), max: Number(await stage.getAttribute('data-y-max')) };
  const config = await exportFile(page);
  expect(config.panels.find((p: { type: string }) => p.type === 'scope').manualYRange).toEqual(range);
  await page.reload();
  await expect.poll(async () => Number(await stage.getAttribute('data-y-min'))).toBeCloseTo(range.min, 8);
  await expect.poll(async () => Number(await stage.getAttribute('data-y-max'))).toBeCloseTo(range.max, 8);
  await page.getByLabel('Y axis mode for Scope 1').selectOption('fit');
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await importFile(page, config);
  await page.getByRole('button', { name: 'Close settings panel', exact: true }).click();
  await expect.poll(async () => Number(await stage.getAttribute('data-y-min'))).toBeCloseTo(range.min, 8);
  await expect.poll(async () => Number(await stage.getAttribute('data-y-max'))).toBeCloseTo(range.max, 8);
});

test('bar bounds, group bindings, indicator colors and 3D settings round-trip together', async ({ page }) => {
  const { DEFAULT_WRISTED } = await import('../src/wristed/config');
  await page.goto('/?demo=1');
  const config = await exportFile(page);
  config.panels = [config.panels.find((p: { type: string }) => p.type === 'sources'),
    { id: 'bars', type: 'value-bar', title: 'Saved bars', channelKeys: ['controller.target', 'controller.speed', 'controller.error'],
      layout: { x: 3, y: 0, width: 3, height: 4 }, rangeMode: 'manual', manualMin: -50, manualMax: 2000,
      channelRanges: { 'controller.target': { mode: 'manual', min: 800, max: 1600 },
        'controller.speed': { mode: 'manual', min: -25, max: 1750 }, 'controller.error': { mode: 'auto', min: -10, max: 10 } } },
    { id: 'indicators', type: 'indicators', title: 'Saved indicators', channelKeys: [], channelGroup: 'limit',
      layout: { x: 6, y: 0, width: 3, height: 2 }, stateColors: [
        { value: 0, label: 'Off', color: '#718096' }, { value: 1, label: 'Custom enabled', color: '#abcdef' }] },
    { id: 'wrist', type: 'wristed', title: 'Saved wrist', channelKeys: [],
      layout: { x: 6, y: 2, width: 6, height: 4 }, wristed: { ...DEFAULT_WRISTED,
        appearance: 'model', angleUnit: 'deg', angle: 35, psi: [170, 10, 30, 20, 15, -10],
        dimensions: { ...DEFAULT_WRISTED.dimensions, jawLength: 12 } } },
    { id: 'plot', type: 'scope', title: 'Saved plot', channelKeys: ['controller.target'],
      layout: { x: 0, y: 7, width: 12, height: 4 }, yScaleMode: 'manual',
      manualYRange: { min: -100, max: 1800 }, windowMode: 'manual', windowSeconds: 12 },
  ];
  await importFile(page, config);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('status')).toContainText('Imported 5 panels');
  await page.getByRole('button', { name: 'Close settings panel', exact: true }).click();
  await page.reload();
  const bars = page.getByRole('region', { name: 'Saved bars', exact: true });
  await expect(bars.getByRole('button', { name: 'Edit minimum for Target', exact: true })).toHaveText('800');
  await expect(bars.getByRole('button', { name: 'Edit maximum for Target', exact: true })).toHaveText('1600');
  await expect(bars.getByRole('button', { name: 'Edit minimum for Speed', exact: true })).toHaveText('-25');
  await expect(bars.getByRole('button', { name: 'Edit maximum for Speed', exact: true })).toHaveText('1750');
  await expect(bars.getByRole('button', { name: 'Reset learned range for Error', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved wrist', exact: true }).getByRole('button', { name: 'Use instrument model', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Visible time window for Saved plot')).toHaveValue('12');
  const exported = await exportFile(page);
  for (const id of ['bars', 'indicators', 'wrist', 'plot']) {
    const { layout: _, ...saved } = config.panels.find((p: { id: string }) => p.id === id);
    expect(exported.panels.find((p: { id: string }) => p.id === id)).toMatchObject(saved);
  }
});

test('offline imports retain styles when a producer connects and edits the inherited layout', async ({ page }) => {
  let publish: (() => void) | undefined;
  await page.routeWebSocket('**/api/ws', socket => {
    socket.send(JSON.stringify({ type: 'catalog', sources: [] }));
    publish = () => socket.send(JSON.stringify({ type: 'catalog', sources: [{ id: 17, name: 'later', programKey: 'later',
      active: true, channels: [{ sourceId: 17, key: 'controller.target', valueType: 'FLOAT64', lastValue: 1, lastSeen: 1 }] }] }));
  });
  await page.goto('/');
  const config = await exportFile(page);
  config.channelStyles = { 'controller.target': style };
  await importFile(page, config);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('status')).toContainText('Imported');
  await page.getByRole('button', { name: 'Close settings panel', exact: true }).click();
  await expect.poll(() => Boolean(publish)).toBe(true);
  publish!();
  await assertStyle(page, 'Target');
  await page.getByRole('button', { name: 'Close style editor', exact: true }).click();
  await page.getByLabel('Visible time window for Scope 1').fill('15');
  await assertStyle(page, 'Target');
  await page.getByRole('button', { name: 'Reset default', exact: true }).click();
  await expect(page.getByLabel('Color for Target', { exact: true })).not.toHaveValue(style.color);
});
