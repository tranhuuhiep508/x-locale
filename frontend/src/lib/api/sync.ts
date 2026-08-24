import { api } from '@/lib/api/client'
import type { ImportResult } from '@/lib/api/types'

export type ExportParams = {
  format: 'json' | 'xlsx'
  layout: 'flat' | 'modular'
  stage: 'draft' | 'public'
  locale?: string
}

export const syncApi = {
  importFile: (
    projectId: string,
    formData: FormData,
    params: { locale?: string; dry_run?: string },
  ) => api.upload<ImportResult>(`/projects/${projectId}/import`, formData, params),

  exportFile: (projectId: string, params: ExportParams) =>
    api.download(`/projects/${projectId}/export`, params, `export.${params.format}`),
}
