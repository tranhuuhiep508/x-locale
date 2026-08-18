import { Link, useRouterState } from '@tanstack/react-router'
import { LogOut, ChevronDown, Layers } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/lib/api/auth'
import { meQuery } from '@/lib/queries'
import { useToast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user } = useQuery(meQuery())

  const qc = useQueryClient()
  const toast = useToast()

  const logoutMut = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      qc.clear()
      window.location.href = '/login'
    },
    onError: () => toast.error('Logout failed'),
  })

  return (
    <div className="flex flex-col min-h-screen bg-muted">
      <header className="sticky top-0 z-30 h-14 bg-background border-b flex items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground hover:text-primary">
          <Layers className="h-5 w-5 text-primary" />
          TMS
        </Link>
        <div className="flex-1" />
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <Avatar size="sm">
                  {user.avatar_url ? (
                    <AvatarImage src={user.avatar_url} alt={user.name} />
                  ) : null}
                  <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="font-medium hidden sm:inline">{user.name}</span>
                <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={logoutMut.isPending}
                  onSelect={(e) => {
                    e.preventDefault()
                    logoutMut.mutate()
                  }}
                >
                  {logoutMut.isPending ? <Spinner /> : <LogOut />}
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}

export function useCurrentPathname() {
  return useRouterState({ select: (s) => s.location.pathname })
}
