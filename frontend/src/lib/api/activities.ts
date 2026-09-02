import { api } from '@/lib/api/client'
import type { ActivityFeedResponse, ActivityListResponse, RestoreVersionResult } from '@/lib/api/types'

export type ActivityListParams = {
  page?: number
  page_size?: number
  event_type?: string
  actor?: string
  string_id?: string
}

export type ActivityFeedParams = {
  page?: number
  page_size?: number
  event_type?: string
  actor?: string
  locale?: string
  since?: string
  until?: string
}

export const activitiesApi = {
  list: (projectId: string, params?: ActivityListParams) =>
    api.get<ActivityListResponse>(`/projects/${projectId}/activities`, params),
  feed: (projectId: string, params?: ActivityFeedParams) =>
    api.get<ActivityFeedResponse>(`/projects/${projectId}/activities/feed`, params),
  forString: (projectId: string, stringId: string, params?: { page?: number; page_size?: number }) =>
    api.get<ActivityListResponse>(`/projects/${projectId}/strings/${stringId}/activities`, params),
  restoreVersion: (projectId: string, stringId: string, activityId: string) =>
    api.post<RestoreVersionResult>(`/projects/${projectId}/strings/${stringId}/activities/${activityId}/restore`),
  revert: (projectId: string, activityId: string) =>
    api.post(`/projects/${projectId}/activities/${activityId}/revert`),
  revertBatch: (projectId: string, batchId: string) =>
    api.post<{ reverted: number; batch_id: string }>(
      `/projects/${projectId}/activities/batch/${batchId}/revert`,
      undefined,
      { force: true },
    ),
}
