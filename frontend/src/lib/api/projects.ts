import { api } from '@/lib/api/client'
import type {
  ApiKey,
  ApiKeyCreated,
  Project,
  ProjectCreate,
  ProjectUpdate,
} from '@/lib/api/types'

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (body: ProjectCreate) => api.post<Project>('/projects', body),
  update: (id: string, body: ProjectUpdate) => api.patch<Project>(`/projects/${id}`, body),
  delete: (id: string) => api.delete(`/projects/${id}`),
  listApiKeys: (id: string) => api.get<ApiKey[]>(`/projects/${id}/api-keys`),
  createApiKey: (id: string, name: string) =>
    api.post<ApiKeyCreated>(`/projects/${id}/api-keys`, { name }),
  revokeApiKey: (projectId: string, keyId: string) =>
    api.delete(`/projects/${projectId}/api-keys/${keyId}`),
}
