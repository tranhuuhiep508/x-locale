import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from '@/components/ui'
import { api } from '@/lib/api/client'
import { ApiError } from '@/lib/api/client'
import type { User } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    if (location.pathname === '/login') return

    try {
      await context.queryClient.ensureQueryData({
        queryKey: queryKeys.me(),
        queryFn: () => api.get<User>('/auth/me'),
        staleTime: 5 * 60 * 1000,
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({
          to: '/login',
          search: location.pathname !== '/' ? { from: location.pathname } : undefined,
        })
      }
      // Surface other errors
      throw err
    }
  },
  component: Root,
})

function Root() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}
