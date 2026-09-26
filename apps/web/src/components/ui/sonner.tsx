import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// Sit above the phone bottom nav (shown below md) and clear of the home bar.
// A CSS variable so the offset follows the nav's own breakpoint, not sonner's
// 600px mobile switch.
const bottom = 'var(--toast-offset-bottom)';

/**
 * App toaster, styled from the theme tokens so every named theme (light or
 * dark) gets matching toasts without a separate theme prop. sonner renders its
 * own polite live region, so toasts are announced to screen readers.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      offset={{ bottom }}
      mobileOffset={{ bottom }}
      closeButton
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          error: '!text-destructive',
          actionButton: '!bg-primary !text-primary-foreground',
        },
      }}
      {...props}
    />
  );
}
