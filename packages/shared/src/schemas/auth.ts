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
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  // Accepts either the email or the username in a single field.
  identifier: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;
