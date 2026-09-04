import { z } from 'zod'

export const stringsSearchSchema = z.object({
  module: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  missing_locale: z.string().optional(),
  status: z.enum(['draft', 'public']).optional(),
  has_unpublished_changes: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  pending_delete: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  deleted: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  max_confidence: z.coerce.number().int().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
})

export type StringsSearch = z.infer<typeof stringsSearchSchema>

// Resolved defaults (use these in components)
export function resolveStringsSearch(s: StringsSearch) {
  return { ...s, page: s.page ?? 1, page_size: s.page_size ?? 20 }
}

export const activitySearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional(),
  event_type: z.string().optional(),
  actor: z.string().optional(),
  locale: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
})

export type ActivitySearch = z.infer<typeof activitySearchSchema>

export const projectCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  slug: z.string().max(128).optional(),
  base_language: z.string().default('en'),
  target_languages: z.array(z.string()).min(1, 'Select at least one target language'),
  layout: z.enum(['flat', 'modular']).default('flat'),
})

export type ProjectCreateForm = z.infer<typeof projectCreateSchema>

export const moduleCreateSchema = z.object({
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(128)
    .regex(/^[a-z][a-z0-9_-]*$/, 'Slug must start with a letter and contain only lowercase letters, numbers, underscores, or hyphens'),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
})

export type ModuleCreateForm = z.infer<typeof moduleCreateSchema>

export const tagCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(128),
  color: z.string().default('#64748b'),
})

export type TagCreateForm = z.infer<typeof tagCreateSchema>

export const stringCreateSchema = z.object({
  key: z.string().min(1, 'Key is required').max(512),
  source_text: z.string().min(1, 'Source text is required'),
  description: z.string().optional(),
  module_id: z.string().optional(),
  tag_ids: z.array(z.string()).default([]),
  status: z.enum(['draft', 'public']).default('draft'),
  translations: z.record(z.string()).default({}),
})

export type StringCreateForm = z.infer<typeof stringCreateSchema>

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
})

export type ApiKeyCreateForm = z.infer<typeof apiKeyCreateSchema>
