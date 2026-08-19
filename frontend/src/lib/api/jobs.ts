import { api } from '@/lib/api/client'
import type { Job } from '@/lib/api/types'

export const jobsApi = {
  get: (jobId: string) => api.get<Job>(`/jobs/${jobId}`),
}
