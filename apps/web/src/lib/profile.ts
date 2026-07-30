import type { ProfileDto, UpdateProfileInput } from '@rss/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The caller's sharing profile (SPEC-019); a server-side suggestion until
 *  they first save one. */
export function useProfile() {
  return useQuery({ queryKey: ['profile'], queryFn: () => api<ProfileDto>('/profile') });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      api<ProfileDto>('/profile', { method: 'PUT', body: input }),
    onSuccess: (profile) => qc.setQueryData(['profile'], profile),
  });
}
