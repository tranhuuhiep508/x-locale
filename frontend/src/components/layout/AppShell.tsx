import { Link, useRouterState } from '@tanstack/react-router'
import { LogOut, ChevronDown, Layers } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import type { User } from '../../lib/api/types'
import { queryKeys } from '../../lib/query-keys'
import { useToast } from '../../store'
import { Button } from '../ui/button'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user } = useQuery<User>({
    queryKey: queryKeys.me(),
    queryFn: () => api.get<User>('/auth/me'),
    staleTime: 5 * 60 * 1000,
  })

  const qc = useQueryClient()
  const toast = useToast()

  const logoutMut = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      qc.clear()
      window.location.href = '/login'
    },
    onError: () => toast.error('Logout failed'),
  })

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900 hover:text-brand-700">
          <Layers className="h-5 w-5 text-brand-600" />
          TMS
        </Link>
        <div className="flex-1" />
        {user && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  className="h-7 w-7 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-medium hidden sm:inline">{user.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logoutMut.mutate()}
              isLoading={logoutMut.isPending}
              className="text-slate-500 hover:text-slate-800"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}

export function useCurrentPathname() {
  return useRouterState({ select: (s) => s.location.pathname })
}
