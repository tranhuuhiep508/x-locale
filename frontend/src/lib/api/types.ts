// ── Enums ─────────────────────────────────────────────────────────────
export type TranslationStatus = 'draft' | 'public'
export type ProjectLayout = 'flat' | 'modular'
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

// ── Auth ───────────────────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  name: string
  avatar_url: string | null
}

// ── Languages ──────────────────────────────────────────────────────────
export interface Language {
  code: string
  name: string
}

// ── Projects ───────────────────────────────────────────────────────────
export interface Project {
  id: string
  name: string
  slug: string
  base_language: string
  target_languages: string[]
  layout: ProjectLayout
  string_count: number
  created_at: string | null
  updated_at: string | null
}

export interface ProjectCreate {
  name: string
  slug?: string
  base_language?: string
  target_languages: string[]
  layout: ProjectLayout
}

export interface ProjectUpdate {
  name?: string
  slug?: string
  base_language?: string
  target_languages?: string[]
  layout?: ProjectLayout
}

// ── API Keys ───────────────────────────────────────────────────────────
export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  created_at: string | null
  last_used_at: string | null
  revoked_at: string | null
}

export interface ApiKeyCreated extends ApiKey {
  key: string
}

// ── Modules ────────────────────────────────────────────────────────────
export interface Module {
  id: string
  slug: string
  name: string
  description: string | null
  position: number
  string_count: number
}

export interface ModuleCreate {
  slug: string
  name: string
  description?: string
  position?: number
}

export interface ModuleUpdate {
  slug?: string
  name?: string
  description?: string
  position?: number
}

// ── Tags ───────────────────────────────────────────────────────────────
export interface Tag {
  id: string
  name: string
  color: string
  string_count: number
}

export interface TagCreate {
  name: string
  color?: string
}

export interface TagUpdate {
  name?: string
  color?: string
}

// ── Strings ────────────────────────────────────────────────────────────
export interface Translation {
  id: string | null
  locale: string
  value: string
  updated_at: string | null
}

export interface StringEntry {
  id: string
  key: string
  source_text: string
  description: string | null
  status: TranslationStatus
  module_id: string | null
  module_slug: string | null
  tags: Tag[]
  updated_at: string | null
  translations: Translation[]
}

export interface StringCreate {
  key: string
  source_text: string
  description?: string
  module_id?: string
  tag_ids?: string[]
}

export interface StringUpdate {
  key?: string
  source_text?: string
  description?: string
  module_id?: string | null
  tag_ids?: string[]
  status?: TranslationStatus
}

export interface TranslationUpdate {
  value: string
}

export interface StringListResponse {
  items: StringEntry[]
  total: number
  page: number
  page_size: number
}

// ── Batch ──────────────────────────────────────────────────────────────
export type BatchAction =
  | 'publish'
  | 'unpublish'
  | 'delete'
  | 'move_module'
  | 'add_tags'
  | 'remove_tags'

export interface BatchFilter {
  module_id?: string
  tag_id?: string
  q?: string
  missing_locale?: string
  status?: TranslationStatus
}

export interface BatchRequest {
  action: BatchAction
  string_ids?: string[]
  filter?: BatchFilter
  payload?: Record<string, unknown>
}

export interface BatchResult {
  affected: number
  batch_id: string
}

// ── Translate ──────────────────────────────────────────────────────────
export interface TranslateRequest {
  scope?: 'missing' | 'strings' | 'module' | 'tag'
  string_ids?: string[]
  module_id?: string
  tag_id?: string
  locales?: string[]
  overwrite?: boolean
}

export interface TranslateResult {
  translated_count: number
  locales: string[]
  job_id: string | null
}

// ── Jobs ───────────────────────────────────────────────────────────────
export interface Job {
  id: string
  kind: string
  status: JobStatus
  result: Record<string, unknown> | null
  error: string | null
  created_at: string | null
  completed_at: string | null
}

// ── Activities ─────────────────────────────────────────────────────────
export interface Activity {
  id: string
  actor_type: string
  actor_id: string | null
  actor_label: string
  action: string
  entity_type: string
  entity_id: string
  string_id: string | null
  locale: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  summary: string
  batch_id: string | null
  batch_kind: string | null
  revert_of_id: string | null
  reverted_by_id: string | null
  is_revertible: boolean
  created_at: string | null
}

export interface ActivityListResponse {
  items: Activity[]
  total: number
  page: number
  page_size: number
}

// ── Snapshots ──────────────────────────────────────────────────────────
export interface Snapshot {
  id: string
  name: string
  description: string | null
  kind: string
  string_count: number
  content_hash: string
  created_at: string | null
  content: Record<string, unknown> | null
}

export interface SnapshotCreate {
  name: string
  description?: string
}

export interface SnapshotListResponse {
  items: Snapshot[]
  total: number
}

// ── Import / Export ────────────────────────────────────────────────────
export interface ImportDiff {
  create: string[]
  update: string[]
  orphan: string[]
  create_count: number
  update_count: number
  orphan_count: number
}

export interface ImportResult {
  created: number
  updated: number
  total: number
  dry_run: boolean
  diff: ImportDiff | null
  batch_id: string | null
}
