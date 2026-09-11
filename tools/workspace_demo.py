#!/usr/bin/env python3
"""Synthetic telemetry for assets/workspace.json. Run: python tools/workspace_demo.py.
No external Python dependencies. Ctrl-C stops sending; --csv exports a replayable table.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'sdk/python'))
from debugscope import Scope


def multiply(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def transform(axis=None, angle=0., z=0.):
    m = [[float(i == j) for j in range(4)] for i in range(4)]
    m[2][3] = z
    if axis is not None:
        i, j = {'x': (1, 2), 'y': (2, 0), 'z': (0, 1)}[axis]
        c, s = math.cos(angle), math.sin(angle)
        m[i][i] = m[j][j] = c
        m[i][j], m[j][i] = -s, s
    return m


def segment(length, theta, delta):
    frame = multiply(multiply(transform('z', delta), transform('y', theta)), transform('z', -delta))
    sinc = math.sin(theta) / theta if abs(theta) > 1e-8 else 1.
    cosc = 2 * math.sin(theta / 2)**2 / theta if abs(theta) > 1e-8 else theta / 2
    frame[0][3], frame[1][3], frame[2][3] = length*cosc*math.cos(delta), length*cosc*math.sin(delta), length*sinc
    return frame


def wrist_pose(psi, d):
    insertion, phi, theta, delta, beta1, beta2, _ = psi
    exposed = insertion + d['insertionOffset']
    l0 = max(0., exposed - d['segment'] - d['link1'] - d['link2'])
    l1 = min(max(0., exposed - d['link1'] - d['link2']), d['segment'])
    denominator = d['zeta'] * l0 + l1
    theta0 = theta * d['zeta'] * l0 / denominator if denominator else 0.
    theta1 = theta * l1 / denominator if denominator else 0.
    f = transform('z', phi)
    for step in [segment(l0, theta0, delta), segment(l1, theta1, delta),
                 transform(z=d['link1']), transform('z', d['wristRotation']),
                 transform('x', beta1), transform(z=d['link2']), transform('y', beta2)]:
        f = multiply(f, step)
    # XYZ Euler angles (roll, pitch, yaw), radians. Position matches UI WRIST XYZ.
    return {'position': [f[i][3] for i in range(3)],
            'rotation': [math.atan2(f[2][1], f[2][2]),
                         math.asin(max(-1., min(1., -f[2][0]))), math.atan2(f[1][0], f[0][0])]}


def joint_values(t):
    return [175 + 20*math.sin(.35*t), .45*math.sin(.28*t),
            .7 + .35*math.sin(.55*t), .65*math.sin(.32*t),
            .65*math.sin(.85*t), .55*math.sin(.7*t + .8),
            .65*(1 + math.sin(1.1*t))]


def sample(t, dimensions):
    # The simulated mechanism follows a target with 180 ms delay.
    psi = joint_values(t)
    sim = wrist_pose(psi, dimensions)
    target = wrist_pose(joint_values(t + .18), dimensions)
    return {'psi': psi, 'psi_deg': [psi[0], *map(math.degrees, psi[1:])],
            'sim': sim, 'target': target,
            'error.distance': math.dist(sim['position'], target['position']),
            # Demo statuses only: each channel cycles Off / On / Warning / Fault.
            'limit': [[0, 1, 1, 2, 1, -1][(int(t/3) + i) % 6] for i in range(7)]}


def flatten(data, prefix=''):
    if isinstance(data, dict):
        for key, value in data.items():
            yield from flatten(value, f'{prefix}.{key}' if prefix else key)
    elif isinstance(data, (list, tuple)):
        for i, value in enumerate(data):
            yield from flatten(value, f'{prefix}.{i}')
    else:
        yield prefix, data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=ROOT/'assets/workspace.json')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=4711)
    parser.add_argument('--rate', type=float, default=60.)
    parser.add_argument('--duration', type=float, default=0., help='Seconds; 0 sends until stopped')
    parser.add_argument('--csv', type=Path, help='Export CSV instead of sending (default 30 seconds)')
    args = parser.parse_args()
    if not math.isfinite(args.rate) or not 1 <= args.rate <= 240:
        parser.error('--rate must be between 1 and 240 Hz')
    if not math.isfinite(args.duration) or args.duration < 0:
        parser.error('--duration must be finite and nonnegative')
    workspace = json.loads(args.workspace.read_text(encoding='utf-8-sig'))
    instrument = next(p for p in workspace['panels'] if p['type'] == 'wristed')
    settings = instrument['wristed']
    if settings['bindings'] != [f'psi.{i}' for i in range(7)] or settings['angleUnit'] != 'rad':
        parser.error('This demo expects psi.0 … psi.6 bindings in radians')
    dimensions = settings['dimensions']
    name = workspace['sourceName']
    channels = dict(flatten(sample(0., dimensions)))
    required = {key for p in workspace['panels'] for key in p.get('channelKeys', [])}
    if required - channels.keys():
        parser.error(f'Unsupported workspace channels: {sorted(required - channels.keys())}')
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with args.csv.open('w', newline='') as output:
            writer = csv.DictWriter(output, fieldnames=['time_s', *channels])
            writer.writeheader()
            for i in range(math.ceil((args.duration or 30)*args.rate)):
                writer.writerow({'time_s': i/args.rate, **dict(flatten(sample(i/args.rate, dimensions)))})
        print(f'Wrote {args.csv}', flush=True)
        return
    scope = Scope(name, host=args.host, port=args.port)
    print(f'SYNTHETIC DEMO: {name} → {args.host}:{args.port}, {args.rate:g} Hz, {len(channels)} channels. Ctrl-C to stop.', flush=True)
    started = time.monotonic()
    count = 0
    try:
        while not args.duration or time.monotonic() - started < args.duration:
            scope.frame(sample(time.monotonic() - started, dimensions))
            count += 1
            time.sleep(max(0., started + count/args.rate - time.monotonic()))
    except KeyboardInterrupt:
        pass
    finally:
        scope.close()
        print(f'Stopped after {count} frames.', flush=True)


if __name__ == '__main__':
    main()
