import {
  RULE_ACTIONS,
  RULE_FIELDS,
  type FilterRuleDto,
  type RuleAction,
  type RuleField,
} from '@rss/shared';
import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import { useSubscriptions, type SubscriptionRow } from '@/lib/folders';
import { notify } from '@/lib/notify';
import { useApplyRule, useCreateRule, useDeleteRule, useRules, useUpdateRule } from '@/lib/rules';
import { cn } from '@/lib/utils';

const FIELD_LABEL: Record<RuleField, string> = { title: 'title', author: 'author', content: 'text' };
const ACTION_LABEL: Record<RuleAction, string> = { markRead: 'mark it read', star: 'star it' };

const control =
  'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const feedName = (s: SubscriptionRow) => s.customTitle ?? s.title ?? s.feedUrl;

/**
 * Filter rules on the Settings page (SPEC-025). Each rule reads as a plain
 * sentence, so what it does is clear at a glance. New articles pass the
 * rules as they arrive; "Run on existing articles" applies one to the
 * newest stored articles too.
 */
export function RulesSection() {
  const { data } = useRules();
  const { data: feedsData } = useSubscriptions();
  const subs = [...(feedsData?.items ?? [])].sort((a, b) => feedName(a).localeCompare(feedName(b)));
  const rules = data?.items ?? [];

  const scopeText = (feedId: string | null) => {
    if (!feedId) return 'in all feeds';
    const sub = subs.find((s) => s.feedId === feedId);
    // A rule stays when you unsubscribe; it just stops matching.
    return sub ? `in ${feedName(sub)}` : 'in a feed you no longer follow';
  };

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-labelledby="rules-heading">
      <div>
        <h2 id="rules-heading" className="font-medium">
          Rules
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mark read or star new articles as they arrive. A phrase matches anywhere in the field,
          in upper or lower case, letter for letter.
        </p>
      </div>

      {rules.length > 0 && (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <RuleItem key={rule.id} rule={rule} scope={scopeText(rule.feedId)} />
          ))}
        </ul>
      )}

      <AddRuleForm subs={subs} />
    </section>
  );
}

function RuleItem({ rule, scope }: { rule: FilterRuleDto; scope: string }) {
  const update = useUpdateRule();
  const remove = useDeleteRule();
  const apply = useApplyRule();
  const sentence = `When the ${FIELD_LABEL[rule.field]} contains "${rule.phrase}", ${scope}, ${ACTION_LABEL[rule.action]}.`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-3 text-sm">
      {/* The 16rem basis wraps the buttons under the sentence on a phone,
          instead of squeezing the sentence into a narrow column. */}
      <label className="flex min-w-0 grow basis-64 items-center gap-3">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => update.mutate({ id: rule.id, enabled: e.target.checked })}
          className="size-4 shrink-0 accent-primary"
          aria-describedby={`rule-${rule.id}`}
          aria-label="Rule on"
        />
        <span
          id={`rule-${rule.id}`}
          className={cn('min-w-0 break-words', !rule.enabled && 'text-muted-foreground line-through')}
        >
          {sentence}
        </span>
      </label>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={apply.isPending}
          onClick={() =>
            apply.mutate(rule.id, {
              onSuccess: ({ matched }) =>
                notify.success(`Matched ${matched} ${matched === 1 ? 'article' : 'articles'}.`),
            })
          }
        >
          {apply.isPending ? 'Running…' : 'Run on existing articles'}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Delete rule"
          title="Delete rule"
          onClick={() => {
            if (confirm(`Delete this rule? ${sentence}`)) remove.mutate(rule.id);
          }}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </li>
  );
}

function AddRuleForm({ subs }: { subs: SubscriptionRow[] }) {
  const create = useCreateRule();
  const [field, setField] = useState<RuleField>('title');
  const [phrase, setPhrase] = useState('');
  const [feedId, setFeedId] = useState('');
  const [action, setAction] = useState<RuleAction>('markRead');
  const [error, setError] = useState<string | null>(null);

  function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate(
      { field, phrase: phrase.trim(), action, feedId: feedId || null },
      {
        onSuccess: () => {
          setPhrase('');
          notify.success('Rule added. It applies to new articles as they arrive.');
        },
        onError: (err) =>
          setError(err instanceof ApiRequestError ? (err.body?.message ?? err.message) : 'Could not add the rule.'),
      },
    );
  }

  return (
    <form onSubmit={add} className="space-y-2" aria-label="Add a rule">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>When the</span>
        <select aria-label="Field" className={control} value={field} onChange={(e) => setField(e.target.value as RuleField)}>
          {RULE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {FIELD_LABEL[f]}
            </option>
          ))}
        </select>
        <span>contains</span>
        <input
          aria-label="Phrase"
          required
          minLength={2}
          maxLength={120}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="sponsored"
          className={`${control} w-40`}
        />
        <select aria-label="Feed" className={`${control} max-w-48`} value={feedId} onChange={(e) => setFeedId(e.target.value)}>
          <option value="">in all feeds</option>
          {subs.map((s) => (
            <option key={s.feedId} value={s.feedId}>
              in {feedName(s)}
            </option>
          ))}
        </select>
        <select aria-label="Action" className={control} value={action} onChange={(e) => setAction(e.target.value as RuleAction)}>
          {RULE_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={create.isPending}>
          Add rule
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
