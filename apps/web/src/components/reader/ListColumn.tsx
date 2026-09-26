import type { ReactNode } from 'react';
import type { ArticleSurface } from '@/hooks/use-article-surface';
import { useRowToggle } from '@/hooks/use-article-toggles';
import type { ArticleListItem } from '@/hooks/use-articles';
import { ArticleScroller } from './ArticleScroller';
import { ListView } from './views';
import type { FeedMetaMap } from './article-row';

/** The middle column for the list view; density (comfortable/compact) is applied
 *  inside ListView via the `compact:` variant (SPEC-016). */
export function ListColumn({
  surface,
  feeds,
  selectedId,
  onSelect,
  header,
  empty,
}: {
  surface: ArticleSurface;
  feeds: FeedMetaMap;
  selectedId: string | null;
  onSelect: (article: ArticleListItem) => void;
  header?: ReactNode;
  empty?: ReactNode;
}) {
  const onToggle = useRowToggle();
  return (
    <ArticleScroller surface={surface} header={header} empty={empty}>
      <div className="animate-in fade-in duration-200 motion-reduce:animate-none">
        <ListView
          items={surface.items}
          feeds={feeds}
          selectedId={selectedId}
          focusedId={surface.focusedId}
          onSelect={(a) => {
            surface.setFocusedId(a.id);
            onSelect(a);
          }}
          registerRow={surface.registerRow}
          onToggle={onToggle}
        />
      </div>
    </ArticleScroller>
  );
}
