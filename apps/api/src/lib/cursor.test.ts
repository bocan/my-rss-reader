import { describe, expect, test } from 'vitest';
import { decodeCursor, decodeSearchCursor, encodeCursor, encodeSearchCursor } from './cursor.js';

const UUID = '7f5df44c-808f-406b-b57f-0e58766e2ade';

describe('cursor encode/decode', () => {
  test('round-trips a timestamp string + uuid pair', () => {
    const t = '2026-07-23 13:08:01.158234+00';
    const decoded = decodeCursor(encodeCursor(t, UUID));
    expect(decoded).toEqual({ t, id: UUID });
  });

  test('returns null for garbage base64', () => {
    expect(decodeCursor('!!!not base64!!!')).toBeNull();
  });

  test('returns null for valid base64 that is not JSON', () => {
    const notJson = Buffer.from('hello world', 'utf8').toString('base64url');
    expect(decodeCursor(notJson)).toBeNull();
  });

  test('returns null for JSON missing t', () => {
    const missing = Buffer.from(JSON.stringify({ id: UUID }), 'utf8').toString('base64url');
    expect(decodeCursor(missing)).toBeNull();
  });

  test('returns null for JSON missing id', () => {
    const missing = Buffer.from(JSON.stringify({ t: '2026-01-01' }), 'utf8').toString('base64url');
    expect(decodeCursor(missing)).toBeNull();
  });

  test('returns null for a non-uuid id', () => {
    const bad = Buffer.from(JSON.stringify({ t: '2026-01-01', id: 'nope' }), 'utf8').toString(
      'base64url',
    );
    expect(decodeCursor(bad)).toBeNull();
  });
});

describe('search cursor encode/decode', () => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');

  test('round-trips rank, id, and seen count', () => {
    expect(decodeSearchCursor(encodeSearchCursor(0.4123, UUID, 50))).toEqual({
      r: 0.4123,
      id: UUID,
      n: 50,
    });
  });

  test('returns null for garbage and non-JSON', () => {
    expect(decodeSearchCursor('!!!not base64!!!')).toBeNull();
    expect(decodeSearchCursor(Buffer.from('hello', 'utf8').toString('base64url'))).toBeNull();
  });

  test('returns null for missing or mistyped fields', () => {
    expect(decodeSearchCursor(b64({ id: UUID, n: 1 }))).toBeNull(); // no rank
    expect(decodeSearchCursor(b64({ r: 1, n: 1 }))).toBeNull(); // no id
    expect(decodeSearchCursor(b64({ r: 1, id: UUID }))).toBeNull(); // no seen
    expect(decodeSearchCursor(b64({ r: 'high', id: UUID, n: 1 }))).toBeNull(); // rank not a number
    expect(decodeSearchCursor(b64({ r: 1, id: UUID, n: -1 }))).toBeNull(); // negative seen
  });

  test('the two cursor modes reject each other', () => {
    const chronological = encodeCursor('2026-07-23 13:08:01.158234+00', UUID);
    const search = encodeSearchCursor(0.5, UUID, 10);
    expect(decodeSearchCursor(chronological)).toBeNull();
    expect(decodeCursor(search)).toBeNull();
  });
});
