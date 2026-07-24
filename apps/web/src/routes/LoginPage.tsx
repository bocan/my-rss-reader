import { Rss } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import { useLogin, useRegister, useRegistrationMode } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Mode = 'login' | 'register';

export function LoginPage() {
  const location = useLocation();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite') ?? undefined;
  // Land on the register form when arriving via /register or an invite link.
  const [mode, setMode] = useState<Mode>(
    location.pathname === '/register' || inviteToken ? 'register' : 'login',
  );

  const login = useLogin();
  const register = useRegister();
  const { data: reg } = useRegistrationMode();
  const registrationMode = reg?.mode ?? 'open';
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
        ...(inviteToken ? { inviteToken } : {}),
      });
    }
  }

  // In register mode, the instance's policy may block or gate the form.
  const registrationBlocked =
    mode === 'register' &&
    (registrationMode === 'closed' || (registrationMode === 'invite' && !inviteToken));

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

        {registrationBlocked ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {registrationMode === 'closed'
                ? 'Registration is closed on this instance.'
                : 'You need an invite link to create an account here.'}
            </p>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMode('login')}
            >
              Have an account? Sign in
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={onSubmit} className="space-y-3">
              {mode === 'register' && (
                <>
                  {inviteToken && (
                    <p className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
                      You are registering with an invite.
                    </p>
                  )}
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

            {/* An invite link is register-only; hide the toggle to login-register. */}
            {!inviteToken && (
              <button
                type="button"
                className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
              </button>
            )}
          </>
        )}
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
