import type {
  AdminUser,
  AppSettingsDto,
  CreateInviteInput,
  InviteDto,
  RegistrationMode,
  UpdateUserInput,
} from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

const USERS_KEY = ['admin', 'users'] as const;
const INVITES_KEY = ['admin', 'invites'] as const;
const SETTINGS_KEY = ['admin', 'settings'] as const;

export function useAdminUsers() {
  return useQuery({ queryKey: USERS_KEY, queryFn: () => api<AdminUser[]>('/admin/users') });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & UpdateUserInput) =>
      api<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

export function useInvites() {
  return useQuery({ queryKey: INVITES_KEY, queryFn: () => api<InviteDto[]>('/admin/invites') });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      api<InviteDto>('/admin/invites', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}

export function useDeleteInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}

export function useAdminSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<AppSettingsDto>('/admin/settings'),
  });
}

export function useUpdateAdminSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationMode: RegistrationMode) =>
      api<AppSettingsDto>('/admin/settings', { method: 'PATCH', body: { registrationMode } }),
    onSuccess: (data) => qc.setQueryData(SETTINGS_KEY, data),
  });
}
