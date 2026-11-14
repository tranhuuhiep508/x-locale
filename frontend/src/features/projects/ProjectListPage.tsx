import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Layers,
  Calendar,
  Trash2,
  ArrowUpRight,
  ArrowRight,
  Search,
  LayoutDashboard,
  Terminal,
  X,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { MarkWell, PageBody, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { CatalogFilteredEmpty } from '@/features/catalog/CatalogFilterBar'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ApiError } from '@/lib/api/client'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectSummary } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { projectsQuery } from '@/lib/queries'
import { useToast } from '@/lib/toast'
import { formatDateShort } from '@/lib/utils'

export function ProjectListPage() {
  const { data: projects = [] } = useQuery(projectsQuery())
  const [searchQuery, setSearchQuery] = useState('')
  const [layoutFilter, setLayoutFilter] = useState<'all' | 'modular' | 'flat'>('all')
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [slugConfirm, setSlugConfirm] = useState('')
  const qc = useQueryClient()
  const toast = useToast()

  const deleteMut = useMutation({
    mutationFn: (project: ProjectSummary) => projectsApi.delete(project.slug, project.slug),
    onSuccess: (_data, project) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(project.slug) })
      toast.success('Project deleted')
      setDeleteOpen(false)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete project')
    },
  })

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return projects.filter((p) => {
      if (layoutFilter !== 'all' && p.layout !== layoutFilter) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.base_language.toLowerCase().includes(q) ||
        p.target_languages.some((l) => l.toLowerCase().includes(q))
      )
    })
  }, [projects, searchQuery, layoutFilter])

  return (
    <AppShell>
      <PageBody contained data-tour-ready="projects" className="pb-12">
        <div className="flex flex-col gap-2.5 border-b border-border/70 pb-3">
          <PageHeader
            title="Projects"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {projects.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-tour="cli-sync-hint"
                        className="group/cli h-8 gap-1.5 rounded-lg border border-border/70 bg-muted/35 px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:border-border hover:bg-muted/60 hover:text-foreground"
                      >
                        <Terminal className="size-3.5 shrink-0 text-muted-foreground transition-all duration-200 ease-drift group-hover/cli:translate-x-0.5 group-hover/cli:text-primary" />
                        <span>CLI sync</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-3.5">
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold text-foreground">Sync from code or CI</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Developers can pull or push translations with the CLI. Create an API key inside any project&apos;s Settings.
                        </p>
                        <code className="rounded-md border border-border/70 bg-muted/50 px-2.5 py-1.5 font-mono text-2xs text-foreground">
                          loc push / loc pull
                        </code>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                <Button size="sm" asChild className="shadow-xs">
                  <Link to="/projects/new" data-tour="new-project">
                    <Plus data-icon="inline-start" />
                    New project
                  </Link>
                </Button>
              </div>
            }
          />

          {projects.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <InputGroup className="min-w-52 flex-1 sm:max-w-xs">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by name, slug, or locale..."
                    aria-label="Filter projects"
                  />
                  {searchQuery ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label="Clear search"
                        onClick={() => setSearchQuery('')}
                      >
                        <X />
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>

                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={layoutFilter}
                  aria-label="Filter by layout"
                  onValueChange={(value) => {
                    if (value === 'all' || value === 'modular' || value === 'flat') {
                      setLayoutFilter(value)
                    }
                  }}
                >
                  <ToggleGroupItem value="all">All</ToggleGroupItem>
                  <ToggleGroupItem value="modular">Modular</ToggleGroupItem>
                  <ToggleGroupItem value="flat">Flat</ToggleGroupItem>
                </ToggleGroup>
              </div>

              {searchQuery || layoutFilter !== 'all' ? (
                <Badge variant="secondary" className="animate-galley-swap font-mono text-xs">
                  {filteredProjects.length} match{filteredProjects.length !== 1 ? 'es' : ''}
                </Badge>
              ) : null}
            </div>
          )}
        </div>

        {/* Empty State */}
        {projects.length === 0 ? (
          <EmptyState
            icon={<Layers />}
            title="No projects yet"
            description="Create your first translation project or initialize one using the x-locale CLI."
            action={
              <Button asChild size="lg" className="shadow-xs">
                <Link to="/projects/new">
                  <Plus data-icon="inline-start" />
                  Create project
                </Link>
              </Button>
            }
          />
        ) : filteredProjects.length === 0 ? (
          <CatalogFilteredEmpty
            title="No projects match your filter"
            description="Try searching for a different catalog name, slug, or language code."
            clearLabel="Clear filter"
            onClear={() => {
              setSearchQuery('')
              setLayoutFilter('all')
            }}
          />
        ) : (
          <div data-tour="project-list" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProjects.map((p, index) => {
              const targets = p.target_languages.filter((l) => l !== p.base_language)
              return (
                <Card
                  key={p.id}
                  style={{ '--stagger': Math.min(index + 2, 10) } as React.CSSProperties}
                  className="animate-stage-in group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/85 transition-all duration-300 ease-drift hover:-translate-y-1 hover:border-border hover:shadow-lg focus-within:ring-2 focus-within:ring-ring/40"
                >
                  {/* Animated left meridian spine indicator */}
                  <div
                    className="absolute inset-y-0 left-0 w-1 origin-center scale-y-0 bg-primary transition-transform duration-300 ease-drift group-hover:scale-y-100"
                    aria-hidden="true"
                  />

                  <CardHeader className="pb-3">
                    {/* Link with project name MUST point to /projects/$projectRef/strings for test contracts */}
                    <Link
                      to="/projects/$projectRef/strings"
                      params={{ projectRef: p.slug }}
                      search={{}}
                      className="flex min-w-0 items-start gap-3 rounded-md outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MarkWell className="mt-0.5">
                        <Layers className="size-4" />
                      </MarkWell>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading text-base font-semibold leading-snug tracking-tight transition-colors duration-200 group-hover:text-primary">
                          {p.name}
                        </h2>
                        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <span className="truncate font-mono text-xs">{p.slug}</span>
                          <span className="text-border">·</span>
                          <span className="rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-3xs uppercase text-muted-foreground">
                            {p.layout}
                          </span>
                        </p>
                      </div>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-drift group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
                      />
                    </Link>

                    {p.role === 'admin' ? (
                      <CardAction className="relative z-10">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete ${p.name}`}
                          className="text-muted-foreground transition-colors hover:text-destructive"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSlugConfirm('')
                            setDeleteTarget(p)
                            setDeleteOpen(true)
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </CardAction>
                    ) : null}
                  </CardHeader>

                  <CardContent className="pb-3">
                    {/* Meridian Language Pipeline: Base -> Targets */}
                    <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2 transition-colors duration-200 group-hover:border-border">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="eyebrow text-3xs">Language route</span>
                        <span className="font-mono text-3xs text-muted-foreground">
                          {targets.length} target{targets.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className="rounded-md border border-border/80 bg-background font-mono text-2xs font-semibold text-foreground"
                        >
                          {p.base_language.toUpperCase()}
                        </Badge>
                        <ArrowRight
                          className="size-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-drift group-hover:translate-x-0.5 group-hover:text-primary"
                          aria-hidden="true"
                        />
                        {targets.length > 0 ? (
                          <>
                            {targets.slice(0, 4).map((lang) => (
                              <Badge
                                key={lang}
                                variant="outline"
                                className="rounded-md bg-background/80 font-mono text-2xs text-muted-foreground"
                              >
                                {lang.toUpperCase()}
                              </Badge>
                            ))}
                            {targets.length > 4 && (
                              <Badge
                                variant="outline"
                                className="rounded-md font-mono text-2xs text-muted-foreground"
                              >
                                +{targets.length - 4}
                              </Badge>
                            )}
                          </>
                        ) : (
                          <span className="font-mono text-2xs text-muted-foreground">
                            no targets
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="justify-between border-t border-border/60 bg-muted/20 py-2.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="font-semibold tabular-nums text-foreground">
                        {p.string_count.toLocaleString()}
                      </span>
                      <span>strings</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <Link
                        to="/projects/$projectRef"
                        params={{ projectRef: p.slug }}
                        className="relative z-10 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      >
                        <LayoutDashboard className="size-3" />
                        <span>Overview</span>
                      </Link>
                      <span className="flex items-center gap-1 font-mono text-2xs text-muted-foreground">
                        <Calendar aria-hidden="true" className="size-3 text-muted-foreground" />
                        <span>{formatDateShort(p.updated_at)}</span>
                      </span>
                    </div>
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
          setDeleteTarget(null)
          setSlugConfirm('')
        }}
        onConfirm={() => deleteTarget && slugConfirm === deleteTarget.slug && deleteMut.mutate(deleteTarget)}
        title={deleteTarget ? `Delete "${deleteTarget.name}"?` : 'Delete project?'}
        description={
          deleteTarget ? (
            <div className="flex flex-col gap-3 text-left">
              <p>
                This permanently deletes the project and everything in it — strings, translations,
                modules, tags, API keys, and history. There is no undo.
              </p>
              <Field>
                <FieldLabel htmlFor="confirm_project_slug">
                  Type <span className="font-mono text-foreground">{deleteTarget.slug}</span> to confirm
                </FieldLabel>
                <Input
                  id="confirm_project_slug"
                  aria-label="Project slug"
                  autoComplete="off"
                  spellCheck={false}
                  value={slugConfirm}
                  onChange={(event) => setSlugConfirm(event.target.value)}
                />
                <FieldDescription>Delete stays off until this matches the project slug exactly.</FieldDescription>
              </Field>
            </div>
          ) : null
        }
        confirmLabel="Delete project"
        confirmDisabled={deleteTarget === null || slugConfirm !== deleteTarget.slug}
        isLoading={deleteMut.isPending}
      />
    </AppShell>
  )
}
