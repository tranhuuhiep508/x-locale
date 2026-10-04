import { api } from '@/lib/api/client'
import { resolveTimeRange } from '@/lib/time-range'
import { parseRestorePreview, parseRevertPreview } from './preview-contract'
import type {
  ActivityDetail,
  ActivityFeedResponse,
  ActivityListResponse,
  RestoreVersionResult,
} from '@/lib/api/types'

export type ActivityListParams = {
  page?: number
  page_size?: number
  event_type?: string
  actor?: string
  string_id?: string
  batch_id?: string
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

export type ActivityFeedSearchParams = ActivityFeedParams & {
  period?: string
}

export function toActivityFeedApiParams(params: ActivityFeedSearchParams): ActivityFeedParams {
  const { period, since, until, ...rest } = params
  const resolved = resolveTimeRange({ period, since, until })
  return { ...rest, ...resolved }
}

export const activitiesApi = {
  list: (projectId: string, params?: ActivityListParams) =>
    api.get<ActivityListResponse>(`/projects/${projectId}/activities`, params),
  feed: (projectId: string, params?: ActivityFeedParams) =>
    api.get<ActivityFeedResponse>(`/projects/${projectId}/activities/feed`, params),
  forString: (
    projectId: string,
    stringId: string,
    params?: { page?: number; page_size?: number }
  ) =>
    api.get<ActivityListResponse>(`/projects/${projectId}/strings/${stringId}/activities`, params),
  detail: (projectId: string, activityId: string) =>
    api.get<ActivityDetail>(`/projects/${projectId}/activities/${activityId}`),
  restoreVersion: (projectId: string, stringId: string, activityId: string) =>
    api.post<RestoreVersionResult>(
      `/projects/${projectId}/strings/${stringId}/activities/${activityId}/restore`
    ),
  restoreVersionPreview: (projectId: string, stringId: string, activityId: string) =>
    api
      .get<unknown>(
        `/projects/${projectId}/strings/${stringId}/activities/${activityId}/restore/preview`
      )
      .then(parseRestorePreview),
  revert: (projectId: string, activityId: string) =>
    api.post(`/projects/${projectId}/activities/${activityId}/revert`),
  revertPreview: (projectId: string, activityId: string) =>
    api
      .get<unknown>(`/projects/${projectId}/activities/${activityId}/revert/preview`)
      .then(parseRevertPreview),
  revertBatch: (projectId: string, batchId: string, force = false) =>
    api.post<{ reverted: number; batch_id: string }>(
      `/projects/${projectId}/activities/batch/${batchId}/revert`,
      undefined,
      { force }
    ),
  revertBatchPreview: (projectId: string, batchId: string) =>
    api
      .get<unknown>(`/projects/${projectId}/activities/batch/${batchId}/revert/preview`)
      .then(parseRevertPreview),
}
