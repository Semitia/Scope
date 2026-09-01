import { TextDecoder } from 'node:util';

export const DSCP_HEADER_SIZE = 24;
export const DSCP_MAX_DATAGRAM_SIZE = 1200;

export type ValueType = 'BOOL' | 'INT32' | 'UINT32' | 'INT64' | 'UINT64' | 'FLOAT32' | 'FLOAT64';

export interface DecodedItem {
  key: string;
  valueType: ValueType;
  value: boolean | number;
}

export type DecodedPacket =
  | {
      messageType: 'HELLO';
      sourceId: number;
      sequence: number;
      timestampNs: bigint;
      processId: number;
      sourceName: string;
      sdkName: string;
    }
  | {
      messageType: 'SAMPLE' | 'FRAME';
      sourceId: number;
      sequence: number;
      timestampNs: bigint;
      items: DecodedItem[];
    };

export class ProtocolError extends Error {}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8(buffer: Buffer, start: number, length: number, field: string): string {
  try {
    return utf8Decoder.decode(buffer.subarray(start, start + length));
  } catch {
    throw new ProtocolError(`${field} is not valid UTF-8`);
  }
}

function valueSize(valueType: number): number {
  switch (valueType) {
    case 1:
      return 1;
    case 2:
    case 3:
    case 6:
      return 4;
    case 4:
    case 5:
    case 7:
      return 8;
    default:
      return 0;
  }
}

function readItem(payload: Buffer, initialOffset: number): { item: DecodedItem; offset: number } {
  let offset = initialOffset;
  if (offset + 2 > payload.length) throw new ProtocolError('truncated item key length');
  const keyLength = payload.readUInt16LE(offset);
  offset += 2;
  if (keyLength === 0 || keyLength > 255 || offset + keyLength + 1 > payload.length) {
    throw new ProtocolError('invalid item key length');
  }

  const key = decodeUtf8(payload, offset, keyLength, 'item key');
  offset += keyLength;
  const rawValueType = payload[offset++];
  const encodedSize = valueSize(rawValueType);
  if (encodedSize === 0 || offset + encodedSize > payload.length) {
    throw new ProtocolError('invalid or truncated item value');
  }

  let valueType: ValueType;
  let value: boolean | number;
  switch (rawValueType) {
    case 1:
      valueType = 'BOOL';
      if (payload[offset] > 1) throw new ProtocolError('BOOL value must be 0 or 1');
      value = payload[offset] !== 0;
      break;
    case 2:
      valueType = 'INT32';
      value = payload.readInt32LE(offset);
      break;
    case 3:
      valueType = 'UINT32';
      value = payload.readUInt32LE(offset);
      break;
    case 4: {
      valueType = 'INT64';
      const rawValue = payload.readBigInt64LE(offset);
      value = Number(rawValue);
      break;
    }
    case 5: {
      valueType = 'UINT64';
      const rawValue = payload.readBigUInt64LE(offset);
      value = Number(rawValue);
      break;
    }
    case 6:
      valueType = 'FLOAT32';
      value = payload.readFloatLE(offset);
      break;
    case 7:
      valueType = 'FLOAT64';
      value = payload.readDoubleLE(offset);
      break;
    default:
      throw new ProtocolError('unknown item value type');
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ProtocolError('non-finite numeric value');
  }

  return {
    item: { key, valueType, value },
    offset: offset + encodedSize,
  };
}

export function decodeDatagram(datagram: Buffer): DecodedPacket {
  if (datagram.length < DSCP_HEADER_SIZE) throw new ProtocolError('datagram is smaller than header');
  if (datagram.length > DSCP_MAX_DATAGRAM_SIZE) throw new ProtocolError('datagram exceeds 1200-byte limit');
  if (datagram.toString('ascii', 0, 4) !== 'DSCP') throw new ProtocolError('invalid magic');
  if (datagram[4] !== 1) throw new ProtocolError(`unsupported version ${datagram[4]}`);

  const messageType = datagram[5];
  const payloadLength = datagram.readUInt16LE(6);
  if (payloadLength !== datagram.length - DSCP_HEADER_SIZE) {
    throw new ProtocolError('payload length does not match datagram size');
  }

  const sourceId = datagram.readUInt32LE(8);
  const sequence = datagram.readUInt32LE(12);
  const timestampNs = datagram.readBigUInt64LE(16);
  const payload = datagram.subarray(DSCP_HEADER_SIZE);

  if (messageType === 1) {
    if (payload.length < 7) throw new ProtocolError('truncated HELLO payload');
    const processId = payload.readUInt32LE(0);
    const sourceNameLength = payload.readUInt16LE(4);
    let offset = 6;
    if (sourceNameLength > 255 || offset + sourceNameLength + 1 > payload.length) {
      throw new ProtocolError('invalid HELLO source-name length');
    }
    const sourceName = decodeUtf8(payload, offset, sourceNameLength, 'source name');
    offset += sourceNameLength;
    const sdkNameLength = payload[offset++];
    if (offset + sdkNameLength !== payload.length) throw new ProtocolError('invalid HELLO SDK-name length');
    const sdkName = decodeUtf8(payload, offset, sdkNameLength, 'SDK name');
    return { messageType: 'HELLO', sourceId, sequence, timestampNs, processId, sourceName, sdkName };
  }

  if (messageType === 2) {
    const { item, offset } = readItem(payload, 0);
    if (offset !== payload.length) throw new ProtocolError('trailing bytes in SAMPLE payload');
    return { messageType: 'SAMPLE', sourceId, sequence, timestampNs, items: [item] };
  }

  if (messageType === 3) {
    if (payload.length < 2) throw new ProtocolError('truncated FRAME item count');
    const itemCount = payload.readUInt16LE(0);
    const items: DecodedItem[] = [];
    let offset = 2;
    for (let index = 0; index < itemCount; index += 1) {
      const decoded = readItem(payload, offset);
      items.push(decoded.item);
      offset = decoded.offset;
    }
    if (offset !== payload.length) throw new ProtocolError('trailing bytes in FRAME payload');
    return { messageType: 'FRAME', sourceId, sequence, timestampNs, items };
  }

  throw new ProtocolError(`unknown message type ${messageType}`);
}
