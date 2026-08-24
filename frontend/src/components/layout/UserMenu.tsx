import { ChevronDown, LogOut } from 'lucide-react'
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
        <Button variant="ghost" size="sm" className="gap-2">
          <Avatar size="sm">
            {user.avatar_url ? (
              <AvatarImage src={user.avatar_url} alt={user.name} />
            ) : null}
            <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="hidden font-medium sm:inline">{user.name}</span>
          <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
