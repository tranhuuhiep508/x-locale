import { LogOut } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/lib/api/auth'
import { meQuery } from '@/lib/queries'
import { useToast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'

export function useLogout() {
  const qc = useQueryClient()
  const toast = useToast()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      qc.clear()
      window.location.href = '/login'
    },
    onError: () => toast.error('Logout failed'),
  })
}

export function SignOutMenuItem({
  pending,
  onSignOut,
}: {
  pending: boolean
  onSignOut: () => void
}) {
  return (
    <DropdownMenuItem
      variant="destructive"
      disabled={pending}
      onSelect={(e) => {
        e.preventDefault()
        onSignOut()
      }}
    >
      {pending ? <Spinner /> : <LogOut />}
      Sign out
    </DropdownMenuItem>
  )
}

export function UserMenu() {
  const { data: user } = useQuery(meQuery())
  const logoutMut = useLogout()

  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 gap-2 rounded-full px-1.5">
          <Avatar size="sm">
            {user.avatar_url ? (
              <AvatarImage src={user.avatar_url} alt={user.name} />
            ) : null}
            <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="hidden pr-1.5 text-sm font-medium sm:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2 font-normal">
          <Avatar size="sm">
            {user.avatar_url ? (
              <AvatarImage src={user.avatar_url} alt={user.name} />
            ) : null}
            <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
            <span className="truncate">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <SignOutMenuItem
            pending={logoutMut.isPending}
            onSignOut={() => logoutMut.mutate()}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
