export const queryKeys = {
  me: () => ['me'] as const,
  languages: () => ['languages'] as const,

  projects: () => ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  projectApiKeys: (id: string) => ['projects', id, 'api-keys'] as const,

  modules: (projectId: string) => ['projects', projectId, 'modules'] as const,

  tags: (projectId: string) => ['projects', projectId, 'tags'] as const,

  strings: (projectId: string, search: Record<string, unknown>) =>
    ['projects', projectId, 'strings', search] as const,

    activities: (projectId: string, page: number, pageSize?: number) =>
    ['projects', projectId, 'activities', page, pageSize ?? 20] as const,

  job: (jobId: string) => ['jobs', jobId] as const,
}
