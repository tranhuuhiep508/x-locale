import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { activitiesApi } from '@/lib/api/activities'
import type { ActivityFeedSearchParams } from '@/lib/api/activities'
import { toActivityFeedApiParams } from '@/lib/api/activities'
import { authApi } from '@/lib/api/auth'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi, toStringListParams } from '@/lib/api/strings'
import type { StringListParams } from '@/lib/api/strings'
import { queryKeys } from '@/lib/query-keys'

export const meQuery = () =>
  queryOptions({
    queryKey: queryKeys.me(),
    queryFn: authApi.me,
    staleTime: 5 * 60 * 1000,
  })

export const languagesQuery = () =>
  queryOptions({
    queryKey: queryKeys.languages(),
    queryFn: languagesApi.list,
  })

export const projectsQuery = () =>
  queryOptions({
    queryKey: queryKeys.projects.list(),
    queryFn: projectsApi.list,
    staleTime: 30 * 1000,
  })

export const projectQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => projectsApi.get(id),
    staleTime: 30 * 1000,
  })

export const projectApiKeysQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.projects.apiKeys(id),
    queryFn: () => projectsApi.listApiKeys(id),
  })

export const projectCoverageQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.projects.strings.coverage(id),
    queryFn: () => projectsApi.coverage(id),
  })

export const modulesQuery = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.projects.modules(projectId),
    queryFn: () => modulesApi.list(projectId),
  })

export const tagsQuery = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.projects.tags(projectId),
    queryFn: () => tagsApi.list(projectId),
  })

export const stringsQuery = (
  projectId: string,
  search: StringListParams & { batch_kind?: string },
) => {
  const { batch_kind: _batchKind, ...keySearch } = search
  return queryOptions({
    queryKey: queryKeys.projects.strings.list(projectId, keySearch),
    queryFn: () => stringsApi.list(projectId, toStringListParams(search)),
    placeholderData: (prev) => prev,
  })
}

export const activitiesQuery = (projectId: string, page: number, pageSize?: number) =>
  queryOptions({
    queryKey: queryKeys.projects.activities.list(projectId, { page, pageSize }),
    queryFn: () => activitiesApi.list(projectId, { page, page_size: pageSize }),
  })

export const activityFeedQuery = (projectId: string, params: ActivityFeedSearchParams) =>
  queryOptions({
    queryKey: queryKeys.projects.activities.feed(projectId, {
      page: params.page,
      page_size: params.page_size,
      event_type: params.event_type,
      actor: params.actor,
      locale: params.locale,
      period: params.period,
      since: params.since,
      until: params.until,
    }),
    queryFn: () => activitiesApi.feed(projectId, toActivityFeedApiParams(params)),
  })

export const HISTORY_PAGE_SIZE = 50

export const batchActivitiesQuery = (
  projectId: string,
  batchId: string,
  pageSize = HISTORY_PAGE_SIZE,
) =>
  queryOptions({
    queryKey: queryKeys.projects.activities.batch(projectId, batchId, { page_size: pageSize }),
    queryFn: () =>
      activitiesApi.list(projectId, { batch_id: batchId, page: 1, page_size: pageSize }),
    enabled: Boolean(batchId),
  })

export const stringActivitiesInfiniteQuery = (projectId: string, stringId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.projects.activities.string(projectId, stringId),
    queryFn: ({ pageParam }) =>
      activitiesApi.forString(projectId, stringId, {
        page: pageParam,
        page_size: HISTORY_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.items.length === 0) return undefined
      const loaded = lastPage.page * lastPage.page_size
      return loaded < lastPage.total ? lastPage.page + 1 : undefined
    },
  })

export const activityDetailQuery = (projectId: string, activityId: string) =>
  queryOptions({
    queryKey: queryKeys.projects.activities.detail(projectId, activityId),
    queryFn: () => activitiesApi.detail(projectId, activityId),
  })

export const revertPreviewQuery = (projectId: string, activityId: string) =>
  queryOptions({
    queryKey: queryKeys.projects.activities.revertPreview(projectId, activityId),
    queryFn: () => activitiesApi.revertPreview(projectId, activityId),
    staleTime: 0,
    retry: false,
  })

export const batchRevertPreviewQuery = (projectId: string, batchId: string) =>
  queryOptions({
    queryKey: queryKeys.projects.activities.batchRevertPreview(projectId, batchId),
    queryFn: () => activitiesApi.revertBatchPreview(projectId, batchId),
    staleTime: 0,
    retry: false,
  })

export const restoreVersionPreviewQuery = (
  projectId: string,
  stringId: string,
  activityId: string,
) =>
  queryOptions({
    queryKey: queryKeys.projects.activities.restorePreview(projectId, stringId, activityId),
    queryFn: () => activitiesApi.restoreVersionPreview(projectId, stringId, activityId),
    staleTime: 0,
    retry: false,
  })
