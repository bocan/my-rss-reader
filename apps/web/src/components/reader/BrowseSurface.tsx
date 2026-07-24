import { ChevronLeft } from 'lucide-react';
import type { ArticleSurface } from '@/hooks/use-article-surface';
import type { ArticleListItem } from '@/hooks/use-articles';
import { ReadingPane } from '@/components/reading-pane/ReadingPane';
import { Button } from '@/components/ui/button';
import type { ViewMode } from '@rss/shared';
import { cn } from '@/lib/utils';
import { ArticleScroller } from './ArticleScroller';
import { CardsView, MagazineView } from './views';
import type { FeedMetaMap } from './article-row';

const VIEW_LABEL: Record<'cards' | 'magazine', string> = {
  cards: 'cards',
  magazine: 'magazine',
};

/**
 * The full-width browse region for cards/magazine. Browsing and reading occupy
 * the same region: opening an article hides the grid (kept mounted, so scroll
 * and loaded pages survive) and shows the reader with a Back control.
 */
export function BrowseSurface({
  surface,
  feeds,
  view,
  selectedId,
  onSelect,
  onBack,
}: {
  surface: ArticleSurface;
  feeds: FeedMetaMap;
  view: Extract<ViewMode, 'cards' | 'magazine'>;
  selectedId: string | null;
  onSelect: (article: ArticleListItem) => void;
  onBack: () => void;
}) {
  const View = view === 'cards' ? CardsView : MagazineView;
  const reading = selectedId !== null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Grid stays mounted (just hidden) while reading, so returning restores
          scroll position and every loaded page. */}
      <ArticleScroller surface={surface} className={cn(reading && 'hidden')}>
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

      {reading && (
        <div className="flex h-full min-h-0 flex-col animate-in fade-in duration-200 motion-reduce:animate-none">
          <div className="shrink-0 border-b p-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ChevronLeft className="size-4" /> Back to {VIEW_LABEL[view]}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <ReadingPane articleId={selectedId} />
          </div>
        </div>
      )}
    </div>
  );
}
