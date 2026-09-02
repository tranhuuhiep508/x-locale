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
  published_value: string | null
  updated_at: string | null
}

export interface StringEntry {
  id: string
  key: string
  source_text: string
  description: string | null
  status: TranslationStatus
  pending_delete: boolean
  deleted_at: string | null
  has_unpublished_changes: boolean
  published_at: string | null
  published_key: string | null
  published_source_text: string | null
  published_module_id: string | null
  published_module_slug: string | null
  module_id: string | null
  module_slug: string | null
  tags: Tag[]
  updated_at: string | null
  translations: Translation[]
}

export interface StringCreate {
  key: string
  source_text: string
  description?: string | null
  module_id?: string | null
  tag_ids?: string[]
  status?: TranslationStatus
  translations?: Record<string, string>
}

export interface StringUpdate {
  key?: string
  source_text?: string
  description?: string | null
  module_id?: string | null
  tag_ids?: string[]
  status?: TranslationStatus
  translations?: Record<string, string>
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
  | 'discard_changes'
  | 'discard_delete'
  | 'restore'
  | 'restore_last_history'
  | 'move_module'
  | 'add_tags'
  | 'remove_tags'

export interface BatchFilter {
  module_id?: string
  tag_id?: string
  q?: string
  missing_locale?: string
  status?: TranslationStatus
  pending_delete?: boolean
  has_unpublished_changes?: boolean
  deleted?: boolean
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

export interface TranslatePreviewRequest {
  source_text: string
  description?: string
  locales?: string[]
}

export interface TranslatePreviewResult {
  translations: Record<string, string>
}

export interface TranslateProposalItem {
  string_id: string
  key: string
  source_text: string
  status: TranslationStatus
  description?: string | null
  translations: Record<string, string>
}

export interface TranslateProposalsResult {
  locales: string[]
  items: TranslateProposalItem[]
  job_id: string | null
}

export interface TranslateApplyRequest {
  items: Array<{
    string_id: string
    translations: Record<string, string>
    description?: string | null
  }>
}

export interface TranslateApplyResult {
  translated_count: number
  batch_id: string
  locales: string[]
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
export interface ActivityChange {
  field: string
  before: string | null
  after: string | null
  locale: string | null
}

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
  event_type: string
  summary: string
  batch_id: string | null
  batch_kind: string | null
  revert_of_id: string | null
  reverted_by_id: string | null
  is_revertible: boolean
  created_at: string | null
  changed: ActivityChange[]
}

export interface RestoreVersionResult extends Activity {
  notice: string
  pending_delete: boolean
}

export interface ActivityListResponse {
  items: Activity[]
  total: number
  page: number
  page_size: number
}

export interface ActivityFeedChild {
  id: string
  event_type: string
  summary: string
  string_id: string | null
  string_key: string | null
  locale: string | null
  changed: ActivityChange[]
}

export interface ActivityFeedCard {
  id: string
  kind: 'single' | 'batch'
  event_type: string
  summary: string
  actor_type: string
  actor_label: string
  created_at: string | null
  string_id: string | null
  string_key: string | null
  locale: string | null
  batch_id: string | null
  batch_kind: string | null
  children_count: number
  is_undoable: boolean
  counts: Record<string, number>
  changed: ActivityChange[]
  children: ActivityFeedChild[]
}

export interface ActivityFeedResponse {
  items: ActivityFeedCard[]
  total: number
  page: number
  page_size: number
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
