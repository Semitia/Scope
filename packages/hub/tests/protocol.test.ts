import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeDatagram, ProtocolError } from '../src/protocol.js';

function packet(messageType: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(24);
  header.write('DSCP', 0, 'ascii');
  header.writeUInt8(1, 4);
  header.writeUInt8(messageType, 5);
  header.writeUInt16LE(payload.length, 6);
  header.writeUInt32LE(0x12345678, 8);
  header.writeUInt32LE(9, 12);
  header.writeBigUInt64LE(2_500_000_000n, 16);
  return Buffer.concat([header, payload]);
}

function item(key: string, valueType: number, value: Buffer): Buffer {
  const encodedKey = Buffer.from(key, 'utf8');
  const header = Buffer.alloc(3);
  header.writeUInt16LE(encodedKey.length, 0);
  header.writeUInt8(valueType, 2);
  return Buffer.concat([header.subarray(0, 2), encodedKey, header.subarray(2), value]);
}

test('decodes HELLO identity metadata', () => {
  const name = Buffer.from('controller');
  const sdk = Buffer.from('cpp/0.1');
  const prefix = Buffer.alloc(6);
  prefix.writeUInt32LE(4242, 0);
  prefix.writeUInt16LE(name.length, 4);
  const decoded = decodeDatagram(packet(1, Buffer.concat([prefix, name, Buffer.from([sdk.length]), sdk])));

  assert.deepEqual(decoded, {
    messageType: 'HELLO',
    sourceId: 0x12345678,
    sequence: 9,
    timestampNs: 2_500_000_000n,
    processId: 4242,
    sourceName: 'controller',
    sdkName: 'cpp/0.1',
  });
});

test('decodes every DSCP/1 scalar type in a FRAME', () => {
  const i32 = Buffer.alloc(4);
  i32.writeInt32LE(-42);
  const u32 = Buffer.alloc(4);
  u32.writeUInt32LE(42);
  const i64 = Buffer.alloc(8);
  i64.writeBigInt64LE(-84n);
  const u64 = Buffer.alloc(8);
  u64.writeBigUInt64LE(84n);
  const f32 = Buffer.alloc(4);
  f32.writeFloatLE(1.25);
  const f64 = Buffer.alloc(8);
  f64.writeDoubleLE(-2.5);
  const items = [
    item('bool', 1, Buffer.from([1])),
    item('i32', 2, i32),
    item('u32', 3, u32),
    item('i64', 4, i64),
    item('u64', 5, u64),
    item('f32', 6, f32),
    item('f64', 7, f64),
  ];
  const count = Buffer.alloc(2);
  count.writeUInt16LE(items.length);
  const decoded = decodeDatagram(packet(3, Buffer.concat([count, ...items])));

  assert.equal(decoded.messageType, 'FRAME');
  if (decoded.messageType !== 'FRAME') return;
  assert.deepEqual(decoded.items.map(({ key, valueType, value }) => [key, valueType, value]), [
    ['bool', 'BOOL', true],
    ['i32', 'INT32', -42],
    ['u32', 'UINT32', 42],
    ['i64', 'INT64', -84],
    ['u64', 'UINT64', 84],
    ['f32', 'FLOAT32', 1.25],
    ['f64', 'FLOAT64', -2.5],
  ]);
});

test('rejects malformed and unsafe datagrams', () => {
  const validValue = Buffer.alloc(8);
  validValue.writeDoubleLE(1.5);
  const valid = packet(2, item('speed', 7, validValue));
  const wrongLength = Buffer.from(valid);
  wrongLength.writeUInt16LE(0, 6);
  const nonFinite = Buffer.alloc(8);
  nonFinite.writeDoubleLE(Number.NaN);

  for (const datagram of [
    Buffer.from('short'),
    Buffer.concat([Buffer.from('NOPE'), valid.subarray(4)]),
    wrongLength,
    packet(2, item('bad-bool', 1, Buffer.from([2]))),
    packet(2, item('nan', 7, nonFinite)),
  ]) {
    assert.throws(() => decodeDatagram(datagram), ProtocolError);
  }
});
