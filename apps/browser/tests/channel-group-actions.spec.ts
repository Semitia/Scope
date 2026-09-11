import { expect, test } from '@playwright/test';

test('group visibility and selective styles preserve individual colors and persist', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Hide group controller', exact: true }).click();
  await expect(page.locator('.channel-row.hidden')).toHaveCount(7);
  await page.getByRole('button', { name: 'Show group controller', exact: true }).click();
  await expect(page.locator('.channel-row:not(.hidden)')).toHaveCount(4);
  await page.getByRole('button', { name: 'Style group controller', exact: true }).click();
  await page.getByLabel('Stroke for group controller', { exact: true }).click();
  await expect(page.getByRole('option', { name: 'Dotted', exact: true }).locator('svg line')).toHaveAttribute('stroke-dasharray', '1 9');
  await page.getByRole('option', { name: 'Dotted', exact: true }).click();
  await page.getByLabel('Opacity for group controller', { exact: true }).selectOption('0.25');
  const styles = await page.evaluate(() => JSON.parse(localStorage.getItem('debugscope.channel-styles.v1')!));
  const values = Object.values(styles) as { color: string; linePattern: string; opacity: number }[];
  expect(values).toHaveLength(4);
  expect(new Set(values.map(value => value.color)).size).toBe(4);
  expect(values.every(value => value.linePattern === 'dotted' && value.opacity === .25)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Style group controller', exact: true }).click();
  await expect(page.getByLabel('Opacity for group controller', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('Stroke for group controller', { exact: true })).toHaveText('Dotted');
  await page.screenshot({ path: '../../artifacts/channel-group-style.png' });
});

test('manual group deletion reconciles the live catalog and keeps sibling channels', async ({ page }) => {
  let keys = ['master.target.position.0', 'master.target.position.1', 'target.position.0'];
  const deleted: unknown[] = [];
  await page.routeWebSocket('**/api/ws', socket => {
    const publish = () => {
      const channels = keys.map(key => ({ sourceId: 42, key, valueType: 'FLOAT64', lastValue: 1, lastSeen: 100 }));
      socket.send(JSON.stringify({ type: 'catalog', sources: [{ id: 42, name: 'test-source', programKey: 'test-source',
        active: true, receivedPackets: 1, missingPackets: 0, channels }] }));
    };
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'deleteChannels') {
        deleted.push(message);
        keys = keys.filter(key => !message.keys.includes(key));
        publish();
      }
    });
    publish();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Style group master', exact: true }).click();
  await page.getByRole('button', { name: 'Delete group channels', exact: true }).click();
  await expect(page.getByRole('button', { name: 'master channel group', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'target.position.0', exact: true })).toBeVisible();
  expect(deleted).toEqual([{ type: 'deleteChannels', sourceId: 42, keys: ['master.target.position.0', 'master.target.position.1'] }]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'target.position.0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'master channel group', exact: true })).toHaveCount(0);
});
