import { z } from 'zod';

const cursorPayloadSchema = z.object({
  // Postgres text form of the row's effective sort key (coalesce(publishedAt,
  // fetchedAt)::text), kept verbatim to preserve microsecond precision.
  t: z.string(),
  id: z.uuid(),
});
export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

/** Encode the last row of a page into an opaque base64url cursor. */
export function encodeCursor(sortKey: string, id: string): string {
  const json = JSON.stringify({ t: sortKey, id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode a cursor; returns null on any malformed input (never throws). */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// --- Search mode (SPEC-006) ---------------------------------------------

const searchCursorSchema = z.object({
  r: z.number(), // ts_rank of the last row
  id: z.uuid(), // tiebreak
  n: z.number().int().nonnegative(), // running seen count, for the result cap
});
export type SearchCursorPayload = z.infer<typeof searchCursorSchema>;

/** Encode a relevance-ordered page boundary (rank, id, running seen count). */
export function encodeSearchCursor(rank: number, id: string, seen: number): string {
  const json = JSON.stringify({ r: rank, id, n: seen });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a search cursor; null on any malformed input. A chronological cursor
 * ({ t, id }) fails this, and a search cursor fails decodeCursor, so the route
 * can reject a mode-mismatched cursor as a 400.
 */
export function decodeSearchCursor(cursor: string): SearchCursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = searchCursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
