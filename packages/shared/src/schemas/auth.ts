import { z } from 'zod';

export const registerSchema = z.object({
  email: z.email(),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i, 'Letters, numbers, dashes and underscores only'),
  displayName: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
  // Present when registering through an invite link (SPEC-012).
  inviteToken: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  // Accepts either the email or the username in a single field.
  identifier: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Self-service account edits (SPEC-017). Username is intentionally immutable.
export const updateAccountSchema = z
  .object({
    displayName: z.string().min(1).max(64).optional(),
    email: z.email().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.email !== undefined, {
    message: 'Provide at least one of displayName or email',
  });
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(256),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
