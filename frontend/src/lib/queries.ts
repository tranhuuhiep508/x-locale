import { queryOptions } from '@tanstack/react-query'
import { activitiesApi } from '@/lib/api/activities'
import { authApi } from '@/lib/api/auth'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi } from '@/lib/api/strings'
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
    queryKey: queryKeys.projects(),
    queryFn: projectsApi.list,
    staleTime: 30 * 1000,
  })

export const projectQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.project(id),
    queryFn: () => projectsApi.get(id),
    staleTime: 30 * 1000,
  })

export const projectApiKeysQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.projectApiKeys(id),
    queryFn: () => projectsApi.listApiKeys(id),
  })

export const modulesQuery = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.modules(projectId),
    queryFn: () => modulesApi.list(projectId),
  })

export const tagsQuery = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.tags(projectId),
    queryFn: () => tagsApi.list(projectId),
  })

export const stringsQuery = (projectId: string, search: StringListParams) =>
  queryOptions({
    queryKey: queryKeys.strings(projectId, search),
    queryFn: () => stringsApi.list(projectId, search),
    placeholderData: (prev) => prev,
  })

export const activitiesQuery = (projectId: string, page: number, pageSize?: number) =>
  queryOptions({
    queryKey: queryKeys.activities(projectId, page, pageSize),
    queryFn: () => activitiesApi.list(projectId, { page, page_size: pageSize }),
  })
