import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Layers, Globe, Calendar, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { PageBody, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { projectsApi } from '@/lib/api/projects'
import type { Project } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { projectsQuery } from '@/lib/queries'
import { useToast } from '@/lib/toast'
import { formatDateShort } from '@/lib/utils'
import { useState } from 'react'

export function ProjectListPage() {
  const { data: projects = [] } = useQuery(projectsQuery())

  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const deleteMut = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(id) })
      toast.success('Project deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete project'),
  })

  return (
    <AppShell>
      <PageBody contained className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Workspace"
          title="Projects"
          description={`${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          actions={
            <Link to="/projects/new">
              <Button>
                <Plus data-icon="inline-start" />
                New project
              </Button>
            </Link>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="sky-panel group transition-shadow hover:shadow-sm hover:ring-primary/25"
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to="/projects/$projectId/strings"
                      params={{ projectId: p.id }}
                      search={{}}
                      className="min-w-0 flex-1"
                    >
                      <h2 className="truncate font-semibold tracking-tight text-foreground group-hover:text-primary">
                        {p.name}
                      </h2>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {p.slug}
                      </p>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.preventDefault()
                        setDeleteTarget(p)
                      }}
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge className="font-mono">
                      <Globe data-icon="inline-start" />
                      {p.base_language}
                    </Badge>
                    {p.target_languages.slice(0, 3).map((lang) => (
                      <Badge key={lang} variant="outline" className="font-mono">
                        {lang}
                      </Badge>
                    ))}
                    {p.target_languages.length > 3 && (
                      <Badge variant="outline">+{p.target_languages.length - 3}</Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                    <span>{p.string_count} strings</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      {formatDateShort(p.updated_at)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This will permanently delete the project and all its strings, translations, and history."
        confirmLabel="Delete project"
        isLoading={deleteMut.isPending}
      />
    </AppShell>
  )
}
