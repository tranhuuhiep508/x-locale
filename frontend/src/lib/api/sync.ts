import { api } from '@/lib/api/client'
import type { ImportResult } from '@/lib/api/types'

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
    api.upload<ImportResult>(`/projects/${projectId}/import`, formData, params),

  exportFile: (projectId: string, params: ExportParams) =>
    api.download(`/projects/${projectId}/export`, params, `export.${params.format}`),

  importTemplate: (projectId: string, format: 'json' | 'xlsx') =>
    api.download(
      `/projects/${projectId}/import-template`,
      { format },
      format === 'xlsx' ? 'import-template.xlsx' : 'import-template.json',
    ),
}
