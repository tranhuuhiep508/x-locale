import { api } from '@/lib/api/client'
import type {
  BatchRequest,
  BatchResult,
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
  tag?: string
  q?: string
  missing_locale?: string
  status?: string
  pending_delete?: boolean
  has_unpublished_changes?: boolean
  deleted?: boolean
  max_confidence?: number
  page?: number
  page_size?: number
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
