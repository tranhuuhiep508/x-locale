import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ApiError } from '@/lib/api/client'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectMember, ProjectRole } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { meQuery, projectMembersQuery } from '@/lib/queries'
import { useToast } from '@/lib/toast'

export function ProjectMembersSection({
  projectId,
  isAdmin,
}: {
  projectId: string
  isAdmin: boolean
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  const { data: me } = useQuery(meQuery())
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('editor')
  const [pendingRemoval, setPendingRemoval] = useState<ProjectMember | null>(null)

  const adminCount = members.filter((member) => member.role === 'admin').length

  function invalidate() {
    qc.invalidateQueries({ queryKey: queryKeys.projects.members(projectId) })
  }

  function onError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback)
  }

  const addMut = useMutation({
    mutationFn: () => projectsApi.addMember(projectId, { email: email.trim(), role }),
    onSuccess: () => {
      invalidate()
      setEmail('')
      setRole('editor')
      toast.success('Member added')
    },
    onError: (error) => onError(error, 'Failed to add member'),
  })

  const roleMut = useMutation({
    mutationFn: ({ userId, next }: { userId: string; next: ProjectRole }) =>
      projectsApi.updateMember(projectId, userId, next),
    onSuccess: (_result, variables) => {
      invalidate()
      if (variables.userId === me?.id) {
        qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
        qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      }
      toast.success('Role updated')
    },
    onError: (error) => onError(error, 'Failed to change role'),
  })

  const removeMut = useMutation({
    mutationFn: (userId: string) => projectsApi.removeMember(projectId, userId),
    onSuccess: (_result, userId) => {
      setPendingRemoval(null)
      if (userId === me?.id) {
        qc.removeQueries({ queryKey: queryKeys.projects.detail(projectId) })
        qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
        toast.success('You left the project')
        navigate({ to: '/' })
        return
      }
      invalidate()
      toast.success('Member removed')
    },
    onError: (error) => onError(error, 'Failed to remove member'),
  })

  const leaving = pendingRemoval !== null && pendingRemoval.user_id === me?.id

  return (
    <Card className="border-border/80 shadow-xs">
      <CardContent className="flex flex-col gap-4 pt-6">
        {isAdmin ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (email.trim()) addMut.mutate()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="member-email">Email</FieldLabel>
                <Input
                  id="member-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel id="member-role-label">Role</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={role}
                  aria-labelledby="member-role-label"
                  onValueChange={(value) => {
                    if (value === 'admin' || value === 'editor') setRole(value)
                  }}
                >
                  <ToggleGroupItem value="editor">Editor</ToggleGroupItem>
                  <ToggleGroupItem value="admin">Admin</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>
            <div>
              <Button type="submit" size="sm" disabled={!email.trim() || addMut.isPending}>
                {addMut.isPending ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
                Add member
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Only admins can add or change members.</p>
        )}

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((member) => {
              const soleAdmin = member.role === 'admin' && adminCount < 2
              const isSelf = me?.id === member.user_id
              return (
                <li
                  key={member.user_id}
                  className="flex flex-col gap-3 rounded-lg border border-border/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {member.name || member.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={member.role}
                        disabled={soleAdmin || roleMut.isPending}
                        onValueChange={(value) => {
                          if (value === 'admin' || value === 'editor') {
                            roleMut.mutate({ userId: member.user_id, next: value })
                          }
                        }}
                      >
                        <SelectTrigger aria-label={`Role for ${member.email}`} className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="editor">Editor</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={soleAdmin || removeMut.isPending}
                        aria-label={isSelf ? `Leave ${member.email}` : `Remove ${member.email}`}
                        onClick={() => setPendingRemoval(member)}
                      >
                        {isSelf ? 'Leave' : 'Remove'}
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="secondary" className="capitalize">
                      {member.role}
                    </Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingRemoval !== null}
        onClose={() => {
          if (!removeMut.isPending) setPendingRemoval(null)
        }}
        onConfirm={() => {
          if (pendingRemoval) removeMut.mutate(pendingRemoval.user_id)
        }}
        title={leaving ? 'Leave this project?' : `Remove ${pendingRemoval?.name || pendingRemoval?.email}?`}
        description={
          leaving
            ? 'You will lose access to this project. An admin has to add you again. There is no undo.'
            : 'They lose access to this project, and API keys they created here stop working. There is no undo.'
        }
        confirmLabel={leaving ? 'Leave project' : 'Remove member'}
        isLoading={removeMut.isPending}
      />
    </Card>
  )
}
