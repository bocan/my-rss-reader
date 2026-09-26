import { toast } from 'sonner';
import { ApiRequestError } from './api';

export interface NotifyAction {
  label: string;
  onClick: () => void;
}

interface NotifyOptions {
  /** One button on the toast, e.g. Undo or Retry. */
  action?: NotifyAction;
  /** Milliseconds; defaults to sonner's (4s). Use longer for an Undo window. */
  duration?: number;
}

/**
 * Visible feedback for an action. The toast region is also a polite live
 * region, so this reaches screen readers too; do not pair it with announce().
 * Use announce() alone for state changes the UI already shows (toggles).
 */
export const notify = {
  success: (message: string, opts: NotifyOptions = {}) => toast.success(message, opts),
  info: (message: string, opts: NotifyOptions = {}) => toast(message, opts),
  error: (message: string, opts: NotifyOptions = {}) => toast.error(message, opts),
};

/**
 * The message to show for a failed request: the server's message when it sent
 * one, else `fallback`. A dropped connection gets its own wording.
 */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.body?.message ?? fallback;
  if (err instanceof TypeError) return `${fallback} Check your connection.`;
  return fallback;
}

/**
 * `meta` a mutation can declare for the global error toast (queryClient.ts):
 * `errorMessage` is the toast text; `inlineError` means the component shows
 * the error itself (e.g. a form), so no toast.
 */
export interface MutationFeedbackMeta extends Record<string, unknown> {
  errorMessage?: string;
  inlineError?: boolean;
}
