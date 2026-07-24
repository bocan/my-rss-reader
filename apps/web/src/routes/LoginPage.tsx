import { Rss } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import { useLogin, useRegister } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Mode = 'login' | 'register';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const login = useLogin();
  const register = useRegister();
  const pending = login.isPending || register.isPending;
  const error = login.error ?? register.error;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (mode === 'login') {
      login.mutate({
        identifier: String(form.get('identifier')),
        password: String(form.get('password')),
      });
    } else {
      register.mutate({
        email: String(form.get('email')),
        username: String(form.get('username')),
        displayName: String(form.get('displayName')),
        password: String(form.get('password')),
      });
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Rss className="size-7 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="text-sm text-muted-foreground">A calm place to read the web.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {mode === 'register' && (
            <>
              <Field name="email" type="email" label="Email" autoComplete="email" />
              <Field name="username" label="Username" autoComplete="username" />
              <Field name="displayName" label="Display name" />
            </>
          )}
          {mode === 'login' && (
            <Field name="identifier" label="Email or username" autoComplete="username" />
          )}
          <Field
            name="password"
            type="password"
            label="Password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {error && (
            <p className="text-sm text-destructive">
              {error instanceof ApiRequestError ? error.message : 'Something went wrong'}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  type = 'text',
  autoComplete,
  className,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      />
    </label>
  );
}
