import assert from 'node:assert/strict';
import test from 'node:test';
import type { DecodedPacket } from '../src/protocol.js';
import { TelemetryStore } from '../src/store.js';

function frame(
  sequence: number,
  timestampSeconds: number,
  value: number,
  sourceId = 7,
): DecodedPacket {
  return {
    messageType: 'FRAME',
    sourceId,
    sequence,
    timestampNs: BigInt(Math.round(timestampSeconds * 1e9)),
    items: [{ key: 'motor.speed', valueType: 'FLOAT64', value }],
  };
}

test('discovers sources and channels and preserves identity metadata', () => {
  const store = new TelemetryStore();
  store.ingest({
    messageType: 'HELLO',
    sourceId: 7,
    sequence: 0,
    timestampNs: 0n,
    processId: 123,
    sourceName: 'motor-control',
    sdkName: 'c/0.1',
  }, 10);
  store.ingest(frame(1, 0.1, 1200), 10.1);

  const [source] = store.catalog(10.2);
  assert.equal(source.name, 'motor-control');
  assert.equal(source.programKey, 'motor-control');
  assert.equal(source.processId, 123);
  assert.equal(source.channels[0].key, 'motor.speed');
  assert.equal(source.channels[0].lastValue, 1200);
  assert.equal(source.active, true);
});

test('enforces retention and per-channel point caps and reports sequence loss', () => {
  const store = new TelemetryStore(2, 3);
  store.ingest(frame(0, 0, 10), 100);
  store.ingest(frame(1, 1, 11), 101);
  store.ingest(frame(3, 2, 12), 102);
  store.ingest(frame(4, 3, 13), 103);
  store.ingest(frame(5, 4, 14), 104);

  const snapshot = store.snapshot(104);
  assert.deepEqual(snapshot.channels[0].samples.map((sample) => sample[1]), [12, 13, 14]);
  assert.equal(snapshot.sources[0].missingPackets, 1);
  assert.equal(store.memoryBytes(), 48);

  store.clear();
  assert.equal(store.snapshot(104).channels[0].samples.length, 0);
});

test('enforces the global history memory cap', () => {
  const store = new TelemetryStore(60, 100, 2);
  store.ingest(frame(0, 0, 10), 100);
  store.ingest(frame(1, 1, 11), 101);
  store.ingest(frame(2, 2, 12), 102);

  assert.deepEqual(store.snapshot(102).channels[0].samples.map((sample) => sample[1]), [11, 12]);
  assert.equal(store.memoryBytes(), 32);
});

test('merges repeated runs with the same program name and allows manual deletion', () => {
  const store = new TelemetryStore();
  store.ingest({
    messageType: 'HELLO',
    sourceId: 7,
    sequence: 0,
    timestampNs: 0n,
    processId: 100,
    sourceName: 'controller',
    sdkName: 'cpp/0.1',
  }, 10);
  store.ingest(frame(1, 0.1, 1000, 7), 10.1);

  store.ingest({
    messageType: 'HELLO',
    sourceId: 99,
    sequence: 0,
    timestampNs: 0n,
    processId: 200,
    sourceName: 'controller',
    sdkName: 'cpp/0.1',
  }, 20);
  store.ingest(frame(1, 0.1, 1100, 99), 20.1);

  const snapshot = store.snapshot(20.2);
  assert.equal(snapshot.sources.length, 1);
  assert.equal(snapshot.sources[0].id, 7);
  assert.equal(snapshot.sources[0].processId, 200);
  assert.deepEqual(snapshot.channels[0].samples.map((sample) => sample[1]), [1000, 1100]);

  assert.equal(store.deleteSource(7), true);
  assert.equal(store.catalog(20.2).length, 0);
  assert.equal(store.memoryBytes(), 0);
  assert.equal(store.deleteSource(7), false);
});
