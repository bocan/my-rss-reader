import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Previous / Next article buttons for the reading pane (#23), the same as
 * `k` / `j`. Disabled at the ends of the list; Next stays on while more pages
 * can load.
 */
export function ArticleStepper({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center" role="group" aria-label="Article navigation">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous article"
        title="Previous article (k)"
        disabled={!hasPrev}
        onClick={onPrev}
      >
        <ChevronUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next article"
        title="Next article (j)"
        disabled={!hasNext}
        onClick={onNext}
      >
        <ChevronDown className="size-4" />
      </Button>
    </div>
  );
}
