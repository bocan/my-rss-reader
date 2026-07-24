import type { LoginInput, PublicUser, RegisterInput, RegistrationMode } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from './api';

const SESSION_KEY = ['auth', 'me'] as const;

/** The instance's registration mode; drives what the register page offers. */
export function useRegistrationMode() {
  return useQuery({
    queryKey: ['auth', 'registration-mode'],
    queryFn: () => api<{ mode: RegistrationMode }>('/auth/registration-mode'),
    staleTime: 5 * 60_000,
  });
}

/** Current signed-in user, or null when anonymous. */
export function useSession() {
  return useQuery<PublicUser | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return await api<PublicUser>('/auth/me');
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<PublicUser>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (user) => qc.setQueryData(SESSION_KEY, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api<PublicUser>('/auth/register', { method: 'POST', body: input }),
    onSuccess: (user) => qc.setQueryData(SESSION_KEY, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(SESSION_KEY, null);
      void qc.invalidateQueries();
    },
  });
}
