import {
  REGISTRATION_MODES,
  type AdminUser,
  type InviteDto,
  type RegistrationMode,
  type UserRole,
} from '@rss/shared';
import { Check, ChevronLeft, Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import {
  useAdminSettings,
  useAdminUsers,
  useCreateInvite,
  useDeleteInvite,
  useDeleteUser,
  useInvites,
  useUpdateAdminSettings,
  useUpdateUser,
} from '@/lib/admin';
import { useSession } from '@/lib/auth';
import { cn } from '@/lib/utils';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const fmtDate = (iso: string) => dateFmt.format(new Date(iso));

const MODE_LABEL: Record<RegistrationMode, string> = {
  open: 'Open',
  invite: 'Invite only',
  closed: 'Closed',
};
const MODE_HINT: Record<RegistrationMode, string> = {
  open: 'Anyone can create an account.',
  invite: 'New accounts need an invite link.',
  closed: 'No new accounts can be created.',
};

export function AdminPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ChevronLeft className="size-4" /> Back
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">Administration</h1>
        </div>

        <RegistrationSection />
        <FeedsSection />
        <UsersSection />
        <InvitesSection />
      </div>
    </AppShell>
  );
}

// --- Feeds (default poll interval) ---------------------------------------

function FeedsSection() {
  const { data } = useAdminSettings();
  const update = useUpdateAdminSettings();
  const [mins, setMins] = useState('');
  const current = data ? Math.round(data.defaultPollIntervalSec / 60) : null;

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Feeds</h2>
        <p className="text-sm text-muted-foreground">
          Default poll interval for feeds that don&apos;t set their own.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={1440}
          value={mins}
          placeholder={current != null ? String(current) : '15'}
          onChange={(e) => setMins(e.target.value)}
          className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
        />
        <span className="text-sm text-muted-foreground">minutes</span>
        <Button
          size="sm"
          disabled={update.isPending || mins.trim() === ''}
          onClick={() =>
            update.mutate(
              { defaultPollIntervalSec: Math.max(1, Math.round(Number(mins))) * 60 },
              { onSuccess: () => setMins('') },
            )
          }
        >
          Save
        </Button>
        {current != null && (
          <span className="text-sm text-muted-foreground">Currently every {current} min</span>
        )}
      </div>
    </section>
  );
}

// --- Registration mode ---------------------------------------------------

function RegistrationSection() {
  const { data } = useAdminSettings();
  const update = useUpdateAdminSettings();
  const mode = data?.registrationMode;

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Registration</h2>
        <p className="text-sm text-muted-foreground">Control who may create an account.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {REGISTRATION_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={update.isPending}
            onClick={() => update.mutate({ registrationMode: m })}
            className={cn(
              'flex-1 rounded-md border p-3 text-left transition-colors duration-150 motion-reduce:transition-none',
              mode === m
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'hover:bg-accent',
            )}
          >
            <span className="block text-sm font-medium">{MODE_LABEL[m]}</span>
            <span className="block text-xs text-muted-foreground">{MODE_HINT[m]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// --- Users ---------------------------------------------------------------

function UsersSection() {
  const { data: me } = useSession();
  const { data: users, isLoading } = useAdminUsers();

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">Users</h2>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="space-y-2">
        {users?.map((u) => <UserRow key={u.id} user={u} isSelf={u.id === me?.id} />)}
      </div>
    </section>
  );
}

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const update = useUpdateUser();
  const del = useDeleteUser();
  const [confirming, setConfirming] = useState(false);
  const disabled = user.disabledAt !== null;
  // The current admin cannot demote, disable, or delete themselves here.
  const selfLock = isSelf;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{user.displayName}</span>
          {disabled && (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
              Disabled
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          @{user.username} · {user.email} · joined {fmtDate(user.createdAt)}
        </div>
      </div>

      <select
        aria-label={`Role for ${user.username}`}
        value={user.role}
        disabled={selfLock || update.isPending}
        onChange={(e) => update.mutate({ id: user.id, role: e.target.value as UserRole })}
        className="h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
      >
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>

      <Button
        variant="outline"
        size="sm"
        disabled={selfLock || update.isPending}
        onClick={() => update.mutate({ id: user.id, disabled: !disabled })}
        title={selfLock ? 'You cannot disable your own account' : undefined}
      >
        {disabled ? 'Enable' : 'Disable'}
      </Button>

      {confirming ? (
        <span className="flex items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={del.isPending}
            onClick={() => del.mutate(user.id)}
          >
            Confirm
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${user.username}`}
          disabled={selfLock}
          title={selfLock ? 'You cannot delete your own account' : undefined}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}

// --- Invites -------------------------------------------------------------

function inviteStatus(inv: InviteDto): { label: string; tone: string } {
  if (inv.redeemedAt) return { label: 'Redeemed', tone: 'text-muted-foreground' };
  if (new Date(inv.expiresAt).getTime() <= Date.now())
    return { label: 'Expired', tone: 'text-destructive' };
  return { label: 'Active', tone: 'text-primary' };
}

function InvitesSection() {
  const { data: invites } = useInvites();
  const create = useCreateInvite();
  const del = useDeleteInvite();
  const [role, setRole] = useState<UserRole>('user');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);

  function submit() {
    create.mutate({
      role,
      expiresInDays: days,
      ...(email.trim() ? { email: email.trim() } : {}),
    });
    setEmail('');
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">Invites</h2>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Email (optional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="anyone"
            className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Expires (days)</span>
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
          />
        </label>
        <Button size="sm" disabled={create.isPending} onClick={submit}>
          Create invite
        </Button>
      </div>

      <div className="space-y-2">
        {invites?.length === 0 && (
          <p className="text-sm text-muted-foreground">No invites yet.</p>
        )}
        {invites?.map((inv) => {
          const status = inviteStatus(inv);
          const active = status.label === 'Active';
          return (
            <div
              key={inv.id}
              className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-medium', status.tone)}>{status.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {inv.role} · {inv.email ?? 'anyone'} · expires {fmtDate(inv.expiresAt)}
                  </span>
                </div>
              </div>
              {active && <CopyLink link={inv.link} />}
              {active && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Revoke invite"
                  disabled={del.isPending}
                  onClick={() => del.mutate(inv.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied; the link is still visible for manual copy.
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}
