import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Layers,
  Globe,
  Calendar,
  Trash2,
  ArrowUpRight,
  Search,
  LayoutDashboard,
  FileText,
  Terminal,
  Languages,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { MarkWell, PageBody, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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

export function ProjectListPage() {
  const { data: projects = [] } = useQuery(projectsQuery())
  const [searchQuery, setSearchQuery] = useState('')
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

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.base_language.toLowerCase().includes(q) ||
        p.target_languages.some((l) => l.toLowerCase().includes(q))
    )
  }, [projects, searchQuery])

  // Aggregate workspace metrics
  const totalStrings = useMemo(
    () => projects.reduce((sum, p) => sum + (p.string_count || 0), 0),
    [projects]
  )

  const uniqueLocalesCount = useMemo(() => {
    const set = new Set<string>()
    for (const p of projects) {
      if (p.base_language) set.add(p.base_language)
      for (const t of p.target_languages) set.add(t)
    }
    return set.size
  }, [projects])

  return (
    <AppShell>
      <PageBody contained className="flex flex-col gap-8 pb-16">
        {/* Workspace Page Header */}
        <PageHeader
          eyebrow="Workspace"
          title="Projects"
          description="A central control plane for your translation catalogs, code sync, and localized releases."
          actions={
            <div className="flex items-center gap-2.5">
              <Badge variant="secondary" className="font-mono text-xs">
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </Badge>
              <Link to="/projects/new">
                <Button className="shadow-xs">
                  <Plus data-icon="inline-start" />
                  New project
                </Button>
              </Link>
            </div>
          }
        />

        {/* Workspace Quick Metrics Strip (Only shown when there are projects) */}
        {projects.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
            <div className="sky-panel flex flex-col gap-1 rounded-xl border border-border/70 p-4">
              <span className="eyebrow flex items-center gap-1.5 text-muted-foreground">
                <Layers className="size-3.5 text-primary" />
                Catalogs
              </span>
              <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {projects.length}
              </p>
              <p className="text-[11px] text-muted-foreground">Active repositories</p>
            </div>

            <div className="sky-panel flex flex-col gap-1 rounded-xl border border-border/70 p-4">
              <span className="eyebrow flex items-center gap-1.5 text-muted-foreground">
                <FileText className="size-3.5 text-primary" />
                Managed Strings
              </span>
              <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {totalStrings.toLocaleString()}
              </p>
              <p className="text-[11px] text-muted-foreground">Across all stages</p>
            </div>

            <div className="sky-panel flex flex-col gap-1 rounded-xl border border-border/70 p-4">
              <span className="eyebrow flex items-center gap-1.5 text-muted-foreground">
                <Languages className="size-3.5 text-primary" />
                Total Locales
              </span>
              <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {uniqueLocalesCount}
              </p>
              <p className="text-[11px] text-muted-foreground">Source & target languages</p>
            </div>

            <div className="sky-panel flex flex-col justify-between rounded-xl border border-border/70 bg-primary/5 p-4">
              <div className="flex items-center justify-between">
                <span className="eyebrow flex items-center gap-1.5 text-primary">
                  <Terminal className="size-3.5" />
                  CLI Sync
                </span>
                <span className="font-mono text-[10px] text-primary/80">loc cli</span>
              </div>
              <p className="font-mono text-xs font-semibold text-foreground">
                loc push / loc pull
              </p>
              <p className="text-[11px] text-muted-foreground">Two-stage safe deploy</p>
            </div>
          </div>
        )}

        {/* Search & Filter Bar */}
        {projects.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by name, slug, or locale..."
                className="pl-9 h-9 text-sm"
              />
            </div>
            {searchQuery && (
              <span className="text-xs text-muted-foreground">
                Found {filteredProjects.length} matching project{filteredProjects.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Empty State */}
        {projects.length === 0 ? (
          <EmptyState
            icon={<Layers className="size-8 text-primary" />}
            title="No projects yet"
            description="Create your first translation project or initialize one using the x-locale CLI."
            action={
              <Link to="/projects/new">
                <Button size="lg" className="shadow-xs">
                  <Plus data-icon="inline-start" />
                  Create project
                </Button>
              </Link>
            }
          />
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 py-12 text-center">
            <Search className="size-8 text-muted-foreground/60 mb-2" />
            <h3 className="text-base font-semibold text-foreground">No projects match "{searchQuery}"</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Try searching for a different catalog name, slug, or language code.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setSearchQuery('')}
            >
              Clear search filter
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProjects.map((p) => (
              <Card
                key={p.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-within:ring-2 focus-within:ring-primary/40"
              >
                {/* Subtle top horizon hairline */}
                <div
                  className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  aria-hidden="true"
                />

                <CardHeader className="pb-3">
                  {/* Link with project name MUST point to /projects/$projectRef/strings for test contracts */}
                  <Link
                    to="/projects/$projectRef/strings"
                    params={{ projectRef: p.slug }}
                    search={{}}
                    className="flex min-w-0 items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MarkWell className="mt-0.5 group-hover:bg-primary/20 transition-colors">
                      <Layers className="size-4" />
                    </MarkWell>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <h2 className="truncate text-base font-semibold group-hover:text-primary transition-colors">
                          {p.name}
                        </h2>
                      </CardTitle>
                      <CardDescription className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-xs">{p.slug}</span>
                        <span className="text-border">•</span>
                        <span className="rounded bg-muted px-1 py-0.2 font-mono text-[10px] text-muted-foreground">
                          {p.layout}
                        </span>
                      </CardDescription>
                    </div>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-all duration-200 group-hover:translate-x-0.5 group-hover:translate-y-[-1px] group-hover:text-primary"
                    />
                  </Link>

                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${p.name}`}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={(e) => {
                        e.preventDefault()
                        setDeleteTarget(p)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </CardAction>
                </CardHeader>

                <CardContent className="space-y-3 pb-3">
                  {/* Locales badges strip */}
                  <div>
                    <span className="eyebrow block text-[10px] text-muted-foreground/80 mb-1.5">
                      Languages
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="gap-1 font-mono text-[11px] font-semibold">
                        <Globe data-icon="inline-start" className="size-3 text-primary" />
                        {p.base_language.toUpperCase()}
                        <span className="text-[9px] text-muted-foreground font-normal">(base)</span>
                      </Badge>
                      {p.target_languages.slice(0, 3).map((lang) => (
                        <Badge key={lang} variant="outline" className="font-mono text-[11px]">
                          {lang.toUpperCase()}
                        </Badge>
                      ))}
                      {p.target_languages.length > 3 && (
                        <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                          +{p.target_languages.length - 3}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="justify-between border-t border-border/50 bg-muted/20 py-2.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums text-foreground">
                      {p.string_count.toLocaleString()}
                    </span>
                    <span>strings</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <Link
                      to="/projects/$projectRef"
                      params={{ projectRef: p.slug }}
                      className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <LayoutDashboard className="size-3" />
                      <span>Overview</span>
                    </Link>
                    <span className="flex items-center gap-1 text-muted-foreground/80">
                      <Calendar aria-hidden="true" className="size-3 text-muted-foreground" />
                      <span>{formatDateShort(p.updated_at)}</span>
                    </span>
                  </div>
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
