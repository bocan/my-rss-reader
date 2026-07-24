import type { ArticleSurface } from '@/hooks/use-article-surface';
import type { ArticleListItem } from '@/hooks/use-articles';
import type { ViewMode } from '@rss/shared';
import { ArticleScroller } from './ArticleScroller';
import { CompactView, ListView } from './views';
import type { FeedMetaMap } from './article-row';

/** The middle column for list/compact modes: reader stays a separate column. */
export function ListColumn({
  surface,
  feeds,
  view,
  selectedId,
  onSelect,
}: {
  surface: ArticleSurface;
  feeds: FeedMetaMap;
  view: Extract<ViewMode, 'list' | 'compact'>;
  selectedId: string | null;
  onSelect: (article: ArticleListItem) => void;
}) {
  const View = view === 'compact' ? CompactView : ListView;
  return (
    <ArticleScroller surface={surface}>
      <div key={view} className="animate-in fade-in duration-200 motion-reduce:animate-none">
        <View
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
