import { api } from '@/lib/api/client'
import type { ActivityListResponse } from '@/lib/api/types'

export const activitiesApi = {
  list: (projectId: string, params?: { page?: number; page_size?: number }) =>
    api.get<ActivityListResponse>(`/projects/${projectId}/activities`, params),
  revert: (projectId: string, activityId: string) =>
    api.post(`/projects/${projectId}/activities/${activityId}/revert`),
}
