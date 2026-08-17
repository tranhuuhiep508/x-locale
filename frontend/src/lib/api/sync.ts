import { api } from '@/lib/api/client'
import type { ImportResult } from '@/lib/api/types'

export const syncApi = {
  importFile: (
    projectId: string,
    formData: FormData,
    params: { locale?: string; dry_run?: string },
  ) => api.upload<ImportResult>(`/projects/${projectId}/import`, formData, params),
}
