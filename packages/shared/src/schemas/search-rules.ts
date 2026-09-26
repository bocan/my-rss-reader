import { z } from 'zod';
import { RULE_ACTIONS, RULE_FIELDS } from '../types.js';

/** Most saved searches one user may have (SPEC-025). */
export const MAX_SAVED_SEARCHES = 50;
/** Most filter rules one user may have (SPEC-025). */
export const MAX_FILTER_RULES = 100;
/** "Run on existing articles" looks at this many newest in-scope articles. */
export const RULE_APPLY_LIMIT = 5000;

/** POST /searches body: a name, the query, and the scope at save time. */
export const createSavedSearchSchema = z.object({
  name: z.string().trim().min(1).max(60),
  q: z.string().trim().min(1).max(200),
  feedId: z.uuid().nullable().optional(),
  folderId: z.uuid().nullable().optional(),
  starred: z.boolean().default(false),
  unread: z.boolean().nullable().optional(),
});
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchSchema>;

/** PATCH /searches/:id body. */
export const updateSavedSearchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.name !== undefined || v.position !== undefined, {
    message: 'Provide a name or a position',
  });
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchSchema>;

// A rule phrase is a literal, matched case-insensitively. Two characters at
// least, so a rule cannot match nearly everything by accident.
const phrase = z.string().trim().min(2).max(120);

/** POST /rules body. */
export const createRuleSchema = z.object({
  feedId: z.uuid().nullable().optional(),
  field: z.enum(RULE_FIELDS),
  phrase,
  action: z.enum(RULE_ACTIONS),
});
export type CreateRuleInput = z.infer<typeof createRuleSchema>;

/** PATCH /rules/:id body. */
export const updateRuleSchema = z
  .object({
    enabled: z.boolean().optional(),
    phrase: phrase.optional(),
    field: z.enum(RULE_FIELDS).optional(),
    action: z.enum(RULE_ACTIONS).optional(),
    feedId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
