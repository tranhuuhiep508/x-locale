import { api } from '@/lib/api/client'
import type {
  ApiKey,
  ApiKeyCreated,
  Project,
  ProjectCoverage,
  ProjectMember,
  ProjectRole,
  ProjectSummary,
  ProjectCreate,
  ProjectUpdate,
} from '@/lib/api/types'

export const projectsApi = {
  list: () => api.get<ProjectSummary[]>('/projects'),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  coverage: (id: string) => api.get<ProjectCoverage>(`/projects/${id}/coverage`),
  create: (body: ProjectCreate) => api.post<ProjectSummary>('/projects', body),
  update: (id: string, body: ProjectUpdate) => api.patch<Project>(`/projects/${id}`, body),
  delete: (id: string, confirmSlug: string) =>
    api.delete(`/projects/${id}`, { confirm_slug: confirmSlug }),
  listMembers: (id: string) => api.get<ProjectMember[]>(`/projects/${id}/members`),
  addMember: (id: string, body: { email: string; role: ProjectRole }) =>
    api.post<ProjectMember>(`/projects/${id}/members`, body),
  updateMember: (id: string, userId: string, role: ProjectRole) =>
    api.patch<ProjectMember>(`/projects/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) =>
    api.delete(`/projects/${id}/members/${userId}`),
  listApiKeys: (id: string) => api.get<ApiKey[]>(`/projects/${id}/api-keys`),
  createApiKey: (id: string, name: string) =>
    api.post<ApiKeyCreated>(`/projects/${id}/api-keys`, { name }),
  revokeApiKey: (projectId: string, keyId: string) =>
    api.delete(`/projects/${projectId}/api-keys/${keyId}`),
}
