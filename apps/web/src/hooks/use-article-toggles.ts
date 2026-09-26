import { useQueryClient } from '@tanstack/react-query';
import { announce } from '@/lib/announce';
import type { RowToggle } from '@/components/reader/RowActions';
import { articleFlags, useToggleAnyArticleState, useToggleArticleState } from '@/lib/articles';

/** The list rows' star and read buttons (#32), with the same announcements as the keys. */
export function useRowToggle(): RowToggle {
  const toggle = useToggleAnyArticleState();
  return (article, patch) => {
    toggle(article.id, patch);
    if (patch.read !== undefined) announce(patch.read ? 'Marked as read' : 'Marked as unread');
    if (patch.starred !== undefined) announce(patch.starred ? 'Starred' : 'Unstarred');
  };
}

/**
 * The m / s / S shortcut actions for one article: the open article when there
 * is one, else the focused row (#20). Each flips the article's REAL current
 * state, read from the cache, so the keys work both ways.
 */
export function useArticleToggles(targetId: string | null) {
  const qc = useQueryClient();
  const toggle = useToggleArticleState(targetId ?? '');
  const flags = () => (targetId ? articleFlags(qc, targetId) : undefined);

  return {
    toggleRead: () => {
      if (!targetId) return;
      const read = !(flags()?.read ?? false);
      toggle.mutate({ read });
      announce(read ? 'Marked as read' : 'Marked as unread');
    },
    markUnread: () => {
      if (!targetId) return;
      toggle.mutate({ read: false });
      announce('Marked as unread');
    },
    toggleStar: () => {
      if (!targetId) return;
      const starred = !(flags()?.starred ?? false);
      toggle.mutate({ starred });
      announce(starred ? 'Starred' : 'Unstarred');
    },
    toggleShared: () => {
      if (!targetId) return;
      // An article never opened this session reads as unshared: S shares it.
      const shared = !(flags()?.shared ?? false);
      toggle.mutate({ shared });
      announce(shared ? 'Added to shared items' : 'Removed from shared items');
    },
  };
}
