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
      [...projectKeys.activities.all(id), params] as const,
  },
}

export const queryKeys = {
  me: () => ['me'] as const,
  languages: () => ['languages'] as const,
  projects: projectKeys,
}
