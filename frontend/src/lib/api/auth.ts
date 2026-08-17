import { api } from '@/lib/api/client'
import type { User } from '@/lib/api/types'

export const authApi = {
  me: () => api.get<User>('/auth/me'),
  logout: () => api.post('/auth/logout'),
}
