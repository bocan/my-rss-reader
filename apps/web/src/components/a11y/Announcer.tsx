import { useAnnouncement } from '@/lib/announce';

// A zero-width space toggled by the update count so the text node changes even
// when the same message repeats, which forces the live region to re-announce it.
const ZWSP = '​';

/** Mount once at the app root. Voices announce() calls via a polite live region. */
export function Announcer() {
  const { message, version } = useAnnouncement();
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
      {version % 2 ? ZWSP : ''}
    </div>
  );
}
