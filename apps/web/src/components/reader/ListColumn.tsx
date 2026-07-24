import type { ArticleSurface } from '@/hooks/use-article-surface';
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
}: {
  surface: ArticleSurface;
  feeds: FeedMetaMap;
  selectedId: string | null;
  onSelect: (article: ArticleListItem) => void;
}) {
  return (
    <ArticleScroller surface={surface}>
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
        />
      </div>
    </ArticleScroller>
  );
}
