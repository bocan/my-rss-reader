/** "just now", "7m ago", "3h ago", "2d ago", or "never" for no time. */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const secs = Math.round((now - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
