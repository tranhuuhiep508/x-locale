import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Layers, Globe, Calendar, Trash2 } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button, Badge, Card, CardContent, EmptyState, ConfirmDialog } from '../components/ui'
import { api } from '../lib/api/client'
import type { Project } from '../lib/api/types'
import { queryKeys } from '../lib/query-keys'
import { useToast } from '../store'
import { formatDateShort } from '../lib/utils'
import { useState } from 'react'

export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: queryKeys.projects(),
      queryFn: () => api.get<Project[]>('/projects'),
      staleTime: 30 * 1000,
    }),
  component: ProjectListPage,
})

function ProjectListPage() {
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: queryKeys.projects(),
    queryFn: () => api.get<Project[]>('/projects'),
  })

  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects() })
      toast.success('Project deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete project'),
  })

  return (
    <AppShell>
      <div className="container py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link to="/projects/new">
            <Button>
              <Plus data-icon="inline-start" />
              New project
            </Button>
          </Link>
        </div>

        {projects.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-12 w-12" />}
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
                className="group transition-all hover:ring-primary/30 hover:shadow-sm"
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <Link
                      to="/projects/$projectId/strings"
                      params={{ projectId: p.id }}
                      search={{}}
                      className="flex-1 min-w-0"
                    >
                      <h2 className="font-semibold text-foreground truncate group-hover:text-primary">
                        {p.name}
                      </h2>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.slug}</p>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.preventDefault()
                        setDeleteTarget(p)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge className="gap-1">
                      <Globe className="h-3 w-3" />
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

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.string_count} strings</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDateShort(p.updated_at)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

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
