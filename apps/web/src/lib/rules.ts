import type { CreateRuleInput, FilterRuleDto, UpdateRuleInput } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Filter rules (SPEC-025): "when <field> contains <phrase>, mark read or
 * star". The server applies them to new articles as they arrive; "Run on
 * existing articles" applies one to the newest stored ones.
 */

const KEY = ['rules'] as const;
type RulesData = { items: FilterRuleDto[] };
// Each onSettled below starts the list reload and does not return it: a
// returned promise makes TanStack Query hold the caller's onSuccess/onError
// until the reload (and its retries) end.

export function useRules() {
  return useQuery({ queryKey: KEY, queryFn: () => api<RulesData>('/rules') });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    // The form shows the error next to itself.
    meta: { inlineError: true },
    mutationFn: (input: CreateRuleInput) => api<FilterRuleDto>('/rules', { method: 'POST', body: input }),
    onSuccess: (rule) => qc.setQueryData<RulesData>(KEY, (d) => (d ? { items: [...d.items, rule] } : d)),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not change the rule.' },
    mutationFn: ({ id, ...patch }: UpdateRuleInput & { id: string }) =>
      api<FilterRuleDto>(`/rules/${id}`, { method: 'PATCH', body: patch }),
    // A switch flips at once; a failure puts it back when the list reloads.
    onMutate: ({ id, ...patch }) => {
      qc.setQueryData<RulesData>(KEY, (d) =>
        d ? { items: d.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : d,
      );
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not delete the rule.' },
    mutationFn: (id: string) => api<void>(`/rules/${id}`, { method: 'DELETE' }),
    onMutate: (id) => {
      qc.setQueryData<RulesData>(KEY, (d) => (d ? { items: d.items.filter((r) => r.id !== id) } : d));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** "Run on existing articles". It changes read and starred marks, so the
 *  lists and the counts reload. */
export function useApplyRule() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorMessage: 'Could not run the rule.' },
    mutationFn: (id: string) => api<{ matched: number }>(`/rules/${id}/apply`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
    },
  });
}
