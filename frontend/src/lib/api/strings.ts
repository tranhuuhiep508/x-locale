import { api } from '@/lib/api/client'
import { resolveStringTimeForApi } from '@/lib/time-range'
import type {
  BatchRequest,
  BatchResult,
  PublishPreviewEntries,
  PublishPreviewRequest,
  StringCreate,
  StringEntry,
  StringListResponse,
  StringUpdate,
  TranslateApplyRequest,
  TranslateApplyResult,
  TranslatePreviewRequest,
  TranslatePreviewResult,
  TranslateProposalsResult,
  TranslateRequest,
  TranslateResult,
} from '@/lib/api/types'

export type StringListParams = {
  module?: string
  unassigned_module?: boolean
  tag?: string
  untagged?: boolean
  q?: string
  missing_locale?: string
  missing_any?: boolean
  complete_locale?: string
  status?: string
  pending_delete?: boolean
  never_published?: boolean
  has_unpublished_changes?: boolean
  deleted?: boolean
  max_confidence?: number
  batch_id?: string
  updated_within_days?: 7 | 30
  period?: string
  since?: string
  until?: string
  page?: number
  page_size?: number
  sort?: string
  order?: 'asc' | 'desc'
}

/** Catalog query params. `batch_kind` is a chip label only and is not sent. */
export function toStringListParams(
  search: StringListParams & { batch_kind?: string },
): StringListParams {
  const time = resolveStringTimeForApi(search)
  return {
    module: search.module,
    unassigned_module: search.unassigned_module,
    tag: search.tag,
    untagged: search.untagged,
    q: search.q,
    missing_locale: search.missing_locale,
    missing_any: search.missing_any,
    complete_locale: search.complete_locale,
    status: search.status,
    pending_delete: search.pending_delete,
    never_published: search.never_published,
    has_unpublished_changes: search.has_unpublished_changes,
    deleted: search.deleted,
    max_confidence: search.max_confidence,
    batch_id: search.batch_id,
    since: time.since,
    until: time.until,
    updated_within_days: time.updated_within_days,
    page: search.page,
    page_size: search.page_size,
    sort: search.sort,
    order: search.order,
  }
}

export const stringsApi = {
  list: (projectId: string, params: StringListParams) =>
    api.get<StringListResponse>(`/projects/${projectId}/strings`, params),
  get: (projectId: string, id: string) =>
    api.get<StringEntry>(`/projects/${projectId}/strings/${id}`),
  create: (projectId: string, body: StringCreate) =>
    api.post<StringEntry>(`/projects/${projectId}/strings`, body),
  update: (projectId: string, id: string, body: StringUpdate) =>
    api.patch<StringEntry>(`/projects/${projectId}/strings/${id}`, body),
  delete: (projectId: string, id: string) =>
    api.delete(`/projects/${projectId}/strings/${id}`),
  batch: (projectId: string, body: BatchRequest) =>
    api.post<BatchResult>(`/projects/${projectId}/strings/batch`, body),
  publishPreview: (projectId: string, body: PublishPreviewRequest) =>
    api.post<PublishPreviewEntries>(`/projects/${projectId}/strings/publish-preview`, body),
  translate: (projectId: string, body: TranslateRequest) =>
    api.post<TranslateResult>(`/projects/${projectId}/translate`, body),
  translatePreview: (projectId: string, body: TranslatePreviewRequest) =>
    api.post<TranslatePreviewResult>(`/projects/${projectId}/translate/preview`, body),
  translateProposals: (projectId: string, body: TranslateRequest) =>
    api.post<TranslateProposalsResult>(`/projects/${projectId}/translate/proposals`, body),
  translateMissing: (projectId: string, body: TranslateRequest) =>
    api.post<TranslateProposalsResult>(`/projects/${projectId}/translate/missing`, body),
  translateApply: (projectId: string, body: TranslateApplyRequest) =>
    api.post<TranslateApplyResult>(`/projects/${projectId}/translate/apply`, body),
}
