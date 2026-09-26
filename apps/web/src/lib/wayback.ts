/**
 * The Wayback Machine's copy of a page (SPEC-024). The `/web/<url>` form
 * opens the newest snapshot, or the Wayback search when there is none. The
 * URL goes in as it is: the Wayback Machine reads everything after `/web/`
 * as the address, query string included.
 */
export function waybackUrl(url: string): string {
  return `https://web.archive.org/web/${url}`;
}
