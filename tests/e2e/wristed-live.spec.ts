import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_WRISTED, POSE_LABELS, type Psi } from '../../apps/browser/src/wristed/config';
import { positionOf, wristedFrames } from '../../apps/browser/src/wristed/kinematics';

test('named and vector groups bind all seven instrument inputs and persist', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Hub connected', { exact: true })).toBeVisible();
  const producer = spawn('python3', ['-u', '-c', `
import json, sys
from debugscope import Scope
scope = Scope('wristed-live-test')
for line in sys.stdin:
    scope.frame(json.loads(line))
scope.close()
`], { env: { ...process.env, PYTHONPATH: resolve('sdk/python'), DEBUGSCOPE_UDP_PORT: '49171' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const send = (psi: Psi) => producer.stdin.write(JSON.stringify({ instrument: Object.fromEntries(POSE_LABELS.map((name, i) => [name, i === 6 ? Math.PI / 6 : psi[i]])), pose: [...psi, Math.PI / 6] }) + '\n');
  const expected = (psi: Psi) => 'WRIST XYZ ' + positionOf(wristedFrames(psi, Math.PI / 6, DEFAULT_WRISTED.dimensions).wrist2).toArray().map(v => v.toFixed(2)).join(' / ') + ' mm';
  try {
    send(DEFAULT_WRISTED.psi);
    await page.locator('.source-select').filter({ hasText: 'wristed-live-test' }).click();
    await page.getByRole('button', { name: 'Add panel', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Wristed instrument' }).click();
    const panel = page.getByRole('region', { name: 'Wristed Instrument 1', exact: true });
    await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
    await page.getByRole('combobox', { name: 'Instrument channel group', exact: true }).selectOption('named:instrument.');
    for (const name of POSE_LABELS) {
      await expect(page.getByRole('combobox', { name: `${name} channel`, exact: true })).toHaveValue(`instrument.${name}`);
    }
    await expect(panel.getByRole('status')).toHaveText('LIVE · 7/7 BOUND');
    await expect(panel.locator('.wristed-footer code')).toHaveText(expected(DEFAULT_WRISTED.psi));
    const next: Psi = [180, 0.5, 1.1, 0.7, -0.4, 0.8];
    send(next);
    await expect(panel.locator('.wristed-footer code')).toHaveText(expected(next));
    await page.getByRole('combobox', { name: 'Instrument channel group', exact: true }).selectOption('vector:pose.');
    for (const [i, name] of POSE_LABELS.entries()) {
      await expect(page.getByRole('combobox', { name: `${name} channel`, exact: true })).toHaveValue(`pose.${i}`);
    }
    await page.reload();
    await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Instrument channel group', exact: true })).toHaveValue('vector:pose.');
    // Individual inputs remain editable after a group binding.
    await page.getByRole('combobox', { name: `${POSE_LABELS[6]} channel` }).selectOption('');
    await expect(panel.getByRole('status')).toHaveText('LIVE · 6/7 BOUND');
  } finally {
    producer.stdin.end(); producer.kill();
  }
});
