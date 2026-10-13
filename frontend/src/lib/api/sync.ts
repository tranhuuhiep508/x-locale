import { api } from '@/lib/api/client'
import { RESPOND_ASYNC } from '@/lib/api/jobs'
import type { ImportResult, JobAccepted } from '@/lib/api/types'

export type ExportParams = {
  format: 'json' | 'xlsx'
  layout: 'flat' | 'modular'
  stage: 'draft' | 'public'
  locale?: string
}

export type ImportFileParams = {
  locale?: string
  dry_run?: string
  module_id?: string
  status?: string
  partial?: string
  tag_ids?: string[]
}

export const syncApi = {
  importFile: (projectId: string, formData: FormData, params: ImportFileParams) =>
    api.upload<ImportResult | JobAccepted>(
      `/projects/${projectId}/import`,
      formData,
      params,
      RESPOND_ASYNC,
    ),

  exportFile: (projectId: string, params: ExportParams) =>
    api.download(`/projects/${projectId}/export`, params, `export.${params.format}`),

  importTemplate: (projectId: string, format: 'json' | 'xlsx') =>
    api.download(
      `/projects/${projectId}/import-template`,
      { format },
      format === 'xlsx' ? 'import-template.xlsx' : 'import-template.json',
    ),
}
