import type { StringListParams } from '@/lib/api/strings'

const projectKeys = {
  all: () => ['projects'] as const,
  lists: () => [...projectKeys.all(), 'list'] as const,
  list: () => [...projectKeys.lists()] as const,
  details: () => [...projectKeys.all(), 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  apiKeys: (id: string) => [...projectKeys.detail(id), 'api-keys'] as const,
  modules: (id: string) => [...projectKeys.detail(id), 'modules'] as const,
  tags: (id: string) => [...projectKeys.detail(id), 'tags'] as const,
  strings: {
    all: (id: string) => [...projectKeys.detail(id), 'strings'] as const,
    list: (id: string, search: StringListParams) =>
      [...projectKeys.strings.all(id), search] as const,
  },
  activities: {
    all: (id: string) => [...projectKeys.detail(id), 'activities'] as const,
    list: (id: string, params: { page: number; pageSize?: number }) =>
      [...projectKeys.activities.all(id), 'list', params] as const,
    feed: (id: string, params: Record<string, unknown>) =>
      [...projectKeys.activities.all(id), 'feed', params] as const,
    string: (id: string, stringId: string) =>
      [...projectKeys.activities.all(id), 'string', stringId] as const,
    batch: (id: string, batchId: string, params?: { page?: number; page_size?: number }) =>
      [...projectKeys.activities.all(id), 'batch', batchId, params] as const,
    detail: (id: string, activityId: string) =>
      [...projectKeys.activities.all(id), 'detail', activityId] as const,
    revertPreview: (id: string, activityId: string) =>
      [...projectKeys.activities.all(id), 'revert-preview', activityId] as const,
    batchRevertPreview: (id: string, batchId: string) =>
      [...projectKeys.activities.all(id), 'batch-revert-preview', batchId] as const,
    restorePreview: (id: string, stringId: string, activityId: string) =>
      [...projectKeys.activities.all(id), 'restore-preview', stringId, activityId] as const,
  },
}

export const queryKeys = {
  me: () => ['me'] as const,
  languages: () => ['languages'] as const,
  jobs: {
    detail: (id: string) => ['jobs', id] as const,
  },
  projects: projectKeys,
}
