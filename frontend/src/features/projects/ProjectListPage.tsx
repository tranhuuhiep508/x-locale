import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Layers, Globe, Calendar, Trash2, ArrowUpRight } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { MarkWell, PageBody, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectSummary } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { projectsQuery } from '@/lib/queries'
import { useToast } from '@/lib/toast'
import { formatDateShort } from '@/lib/utils'
import { useState } from 'react'

export function ProjectListPage() {
  const { data: projects = [] } = useQuery(projectsQuery())

  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const deleteMut = useMutation({
    mutationFn: (slug: string) => projectsApi.delete(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(slug) })
      toast.success('Project deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete project'),
  })

  return (
    <AppShell>
      <PageBody contained className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Workspace"
          title="Projects"
          description="A home for your source strings and translations."
          actions={
            <>
              <Badge variant="secondary">
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </Badge>
              <Link to="/projects/new">
                <Button>
                  <Plus data-icon="inline-start" />
                  New project
                </Button>
              </Link>
            </>
          }
        />

        {projects.length === 0 ? (
          <EmptyState
            icon={<Layers />}
            title="No projects yet"
            description="Create your first translation project to get started."
            action={
              <Link to="/projects/new">
                <Button>
                  <Plus data-icon="inline-start" />
                  Create project
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="group transition-shadow hover:shadow-md focus-within:ring-primary/40"
              >
                <CardHeader>
                  <Link
                    to="/projects/$projectRef/strings"
                    params={{ projectRef: p.slug }}
                    search={{}}
                    className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MarkWell>
                      <Layers className="size-4" />
                    </MarkWell>
                    <div className="min-w-0">
                      <CardTitle>
                        <h2 className="truncate">{p.name}</h2>
                      </CardTitle>
                      <CardDescription>
                        <span className="font-mono text-xs">{p.slug}</span>
                      </CardDescription>
                    </div>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="ml-auto size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    />
                  </Link>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${p.name}`}
                      onClick={(e) => {
                        e.preventDefault()
                        setDeleteTarget(p)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">
                      <Globe data-icon="inline-start" />
                      {p.base_language}
                    </Badge>
                    {p.target_languages.slice(0, 3).map((lang) => (
                      <Badge key={lang} variant="outline">
                        {lang}
                      </Badge>
                    ))}
                    {p.target_languages.length > 3 && (
                      <Badge variant="outline">+{p.target_languages.length - 3}</Badge>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground">
                      {p.string_count}
                    </span>{' '}
                    strings
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar aria-hidden="true" className="size-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {formatDateShort(p.updated_at)}
                    </span>
                  </span>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.slug)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This will permanently delete the project and all its strings, translations, and history."
        confirmLabel="Delete project"
        isLoading={deleteMut.isPending}
      />
    </AppShell>
  )
}
