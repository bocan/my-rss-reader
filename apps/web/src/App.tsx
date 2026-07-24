import { Navigate, Route, Routes } from 'react-router';
import { useSession } from '@/lib/auth';
import { LoginPage } from '@/routes/LoginPage';
import { ReaderPage } from '@/routes/ReaderPage';
import { SettingsPage } from '@/routes/SettingsPage';

export function App() {
  const { data: user, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={user ? <ReaderPage /> : <Navigate to="/login" replace />} />
      <Route path="/settings" element={user ? <SettingsPage /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
