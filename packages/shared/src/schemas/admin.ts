import { z } from 'zod';
import { REGISTRATION_MODES } from '../types.js';

/** Registration mode for the instance. */
export const registrationModeSchema = z.enum(REGISTRATION_MODES);

/** PATCH /admin/settings body. */
export const updateAppSettingsSchema = z.object({
  registrationMode: registrationModeSchema,
});
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

/** POST /admin/invites body. */
export const createInviteSchema = z.object({
  email: z.email().optional(),
  role: z.enum(['admin', 'user']).default('user'),
  expiresInDays: z.number().int().min(1).max(90).default(7),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/** PATCH /admin/users/:id body. At least one field must be present. */
export const updateUserSchema = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, {
    message: 'Provide at least one of role or disabled',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
