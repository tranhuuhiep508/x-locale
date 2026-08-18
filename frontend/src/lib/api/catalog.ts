import { api } from '@/lib/api/client'
import type {
  Language,
  Module,
  ModuleCreate,
  ModuleUpdate,
  Tag,
  TagCreate,
  TagUpdate,
} from '@/lib/api/types'

export const languagesApi = {
  list: () => api.get<Language[]>('/languages'),
}

export const modulesApi = {
  list: (projectId: string) => api.get<Module[]>(`/projects/${projectId}/modules`),
  create: (projectId: string, body: ModuleCreate) =>
    api.post<Module>(`/projects/${projectId}/modules`, body),
  update: (projectId: string, id: string, body: ModuleUpdate) =>
    api.patch<Module>(`/projects/${projectId}/modules/${id}`, body),
  delete: (projectId: string, id: string) =>
    api.delete(`/projects/${projectId}/modules/${id}`),
}

export const tagsApi = {
  list: (projectId: string) => api.get<Tag[]>(`/projects/${projectId}/tags`),
  create: (projectId: string, body: TagCreate) =>
    api.post<Tag>(`/projects/${projectId}/tags`, body),
  update: (projectId: string, id: string, body: TagUpdate) =>
    api.patch<Tag>(`/projects/${projectId}/tags/${id}`, body),
  delete: (projectId: string, id: string) =>
    api.delete(`/projects/${projectId}/tags/${id}`),
}
