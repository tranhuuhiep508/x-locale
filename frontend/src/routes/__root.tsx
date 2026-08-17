import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from '@/components/ui'
import { ApiError } from '@/lib/api/client'
import { meQuery } from '@/lib/queries'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    if (location.pathname === '/login') return

    try {
      await context.queryClient.ensureQueryData(meQuery())
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
