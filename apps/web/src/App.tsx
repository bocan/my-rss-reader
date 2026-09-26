import { Navigate, Route, Routes } from 'react-router';
import { useSession } from '@/lib/auth';
import { AdminPage } from '@/routes/AdminPage';
import { LoginPage } from '@/routes/LoginPage';
import { ReaderPage } from '@/routes/ReaderPage';
import { SettingsPage } from '@/routes/SettingsPage';

export function App() {
  // isPending, not isLoading: while the persisted cache restores, the session
  // query is pending but not yet fetching (isLoading false). Routing then
  // would read "signed out" and bounce through /login, which drops a deep
  // link's ?article= on the way back.
  const { data: user, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={user ? <ReaderPage /> : <Navigate to="/login" replace />} />
      <Route path="/settings" element={user ? <SettingsPage /> : <Navigate to="/login" replace />} />
      <Route
        path="/admin"
        element={
          user?.role === 'admin' ? <AdminPage /> : <Navigate to={user ? '/' : '/login'} replace />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
