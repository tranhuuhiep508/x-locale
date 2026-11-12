import { getRouteApi, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ElementType } from 'react'
import {
  AlignLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  GitCompareArrows,
  Globe2,
  KeyRound,
  Layers,
  Settings2,
  Tags,
} from 'lucide-react'
import { ActivityCard } from '@/features/activity/ActivityCard'
import {
  activityFeedQuery,
  languagesQuery,
  modulesQuery,
  projectQuery,
  projectCoverageQuery,
  stringsQuery,
  tagsQuery,
} from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { MarkWell, PageBody, PageHeader } from '@/components/layout/PageHeader'
import type { StringsSearch } from '@/lib/schemas'

const routeApi = getRouteApi('/projects/$projectRef/')

function StatCard({
  icon: Icon,
  label,
  value,
  description,
  projectRef,
  to,
  search,
  accent,
  stagger = 1,
}: {
  icon: ElementType
  label: string
  value: number | string | undefined
  description: string
  projectRef: string
  to: '/projects/$projectRef/strings' | '/projects/$projectRef/settings'
  search?: StringsSearch
  accent?: boolean
  stagger?: number
}) {
  return (
    <Link
      to={to}
      params={{ projectRef }}
      search={search}
      style={{ '--stagger': stagger } as React.CSSProperties}
      className="animate-stage-in group relative min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        size="sm"
        className={`relative h-full overflow-hidden border transition-all duration-300 ease-drift hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md ${
          accent ? 'border-primary/45 bg-primary/5' : 'border-border/85'
        }`}
      >
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 origin-center transition-transform duration-300 ease-drift ${
            accent ? 'scale-y-100 bg-primary' : 'scale-y-0 bg-primary group-hover:scale-y-100'
          }`}
        />
        <CardHeader>
          <CardDescription className="font-mono text-xs font-medium uppercase tracking-wider">
            {label}
          </CardDescription>
          <CardAction className="hidden sm:block">
            <MarkWell className={accent ? 'border-primary/35 bg-primary/15 text-primary' : ''}>
              <Icon className="size-4" />
            </MarkWell>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            {value === undefined ? (
              <Skeleton className="h-7 w-12" aria-label={`Loading ${label.toLowerCase()}`} />
            ) : (
              <p className="font-heading text-xl font-bold tracking-tight tabular-nums text-foreground sm:text-2xl">
                {value}
              </p>
            )}
            <ArrowUpRight
              aria-hidden="true"
              className="hidden size-4 text-muted-foreground transition-transform duration-200 ease-drift group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary sm:block"
            />
          </div>
          <p className="hidden text-xs text-muted-foreground sm:block">{description}</p>
        </CardContent>
      </Card>
    </Link>
  )
}

function LanguageCoverage({
  projectRef,
  locale,
  name,
  total,
  missing,
  unavailable,
  onRetry,
}: {
  projectRef: string
  locale: string
  name: string
  total: number
  missing: number | undefined
  unavailable: boolean
  onRetry: () => void
}) {
  const translated = missing == null ? null : Math.max(0, total - missing)
  const percent =
    translated == null ? null : total === 0 ? 0 : Math.round((translated / total) * 100)

  return (
    <li className="flex min-w-0 flex-col gap-2.5 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Badge variant="outline" className="rounded-md bg-muted/40 font-mono text-xs font-semibold">
            {locale.toUpperCase()}
          </Badge>
          <h3 className="min-w-0 font-medium text-foreground wrap-anywhere">{name}</h3>
        </div>
        {percent == null ? (
          unavailable ? (
            <span className="font-mono text-xs text-muted-foreground">Unavailable</span>
          ) : (
            <Skeleton className="h-5 w-10" />
          )
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-heading text-sm font-semibold tabular-nums text-foreground">
              {percent}%
            </span>
          </div>
        )}
      </div>
      {percent == null ? (
        unavailable ? null : (
          <Skeleton className="h-1.5 w-full" />
        )
      ) : (
        <Progress
          value={percent}
          className="h-1.5"
          aria-label={`${name} translation coverage`}
          aria-valuetext={`${translated} of ${total} strings translated`}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {translated == null
            ? unavailable
              ? 'Couldn’t load coverage.'
              : 'Loading coverage…'
            : total === 0
              ? 'No strings yet'
              : `${translated} of ${total} strings translated`}
        </p>
        {unavailable ? (
          <Button variant="ghost" size="sm" aria-label={`Retry ${name} coverage`} onClick={onRetry}>
            Retry
          </Button>
        ) : (
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/projects/$projectRef/strings"
              params={{ projectRef }}
              search={
                total === 0
                  ? {}
                  : missing === 0
                    ? { complete_locale: locale }
                    : { missing_locale: locale }
              }
              className="text-xs font-medium transition-colors hover:text-primary"
            >
              {total === 0
                ? 'View strings'
                : missing === 0
                  ? 'View translations'
                  : missing == null
                    ? 'View missing'
                    : `${missing} missing`}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </div>
    </li>
  )
}


export function ProjectOverviewPage() {
  const { projectRef } = routeApi.useParams()
  const projectQueryResult = useQuery(projectQuery(projectRef))
  const project = projectQueryResult.data
  const modulesResult = useQuery(modulesQuery(projectRef))
  const tagsResult = useQuery(tagsQuery(projectRef))
  const { data: languages = [] } = useQuery(languagesQuery())
  const coverage = useQuery({
    ...projectCoverageQuery(projectRef),
    enabled: Boolean(project),
  })
  const publish = useQuery({
    ...stringsQuery(projectRef, { has_unpublished_changes: true, page: 1, page_size: 1 }),
    enabled: Boolean(project),
  })
  const activity = useQuery(activityFeedQuery(projectRef, { page: 1, page_size: 5 }))

  if (!project)
    return (
      <PageBody>
        {projectQueryResult.isError ? (
          <EmptyState
            title="Couldn’t load this project"
            description="Try loading the overview again."
            action={
              <Button variant="outline" onClick={() => void projectQueryResult.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <>
            <Skeleton className="h-16 w-64" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-72 w-full" />
          </>
        )}
      </PageBody>
    )

  const total = coverage.data?.total ?? project.string_count
  const targetLocales = project.target_languages.filter((locale) => locale !== project.base_language)
  const coverageByLocale = new Map(coverage.data?.locales.map((row) => [row.locale, row]))
  const languageName = (locale: string) =>
    languages.find((language) => language.code === locale)?.name ?? locale

  const overallPercent = (() => {
    if (!coverage.data || targetLocales.length === 0 || total === 0) return null
    let sumTranslated = 0
    for (const locale of targetLocales) {
      const missing = coverageByLocale.get(locale)?.missing
      if (missing == null) return null
      sumTranslated += Math.max(0, total - missing)
    }
    return Math.round((sumTranslated / (total * targetLocales.length)) * 100)
  })()

  return (
    <PageBody className="mx-auto w-full max-w-7xl pb-12">
      {/* Overview Page Header */}
      <PageHeader
        className="border-b border-border/70 pb-3"
        title="Overview"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/projects/$projectRef/settings" params={{ projectRef }}>
                <Settings2 data-icon="inline-start" />
                Settings
              </Link>
            </Button>
            <Button size="sm" asChild className="shadow-xs">
              <Link to="/projects/$projectRef/strings" params={{ projectRef }} search={{}}>
                Open catalog
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        }
      />

      {/* Primary Key Stats Grid */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          icon={AlignLeft}
          label="Strings"
          value={total}
          description="Browse your catalog"
          projectRef={projectRef}
          to="/projects/$projectRef/strings"
          search={{}}
          stagger={1}
        />
        <StatCard
          icon={Globe2}
          label="Languages"
          value={targetLocales.length}
          description="Target languages"
          projectRef={projectRef}
          to="/projects/$projectRef/settings"
          stagger={2}
        />
        <StatCard
          icon={GitCompareArrows}
          label="Pending edits"
          value={publish.data?.total ?? (publish.isError ? '—' : undefined)}
          description="Changes to published strings"
          projectRef={projectRef}
          to="/projects/$projectRef/strings"
          search={{ has_unpublished_changes: true }}
          accent={Boolean(publish.data?.total && publish.data.total > 0)}
          stagger={3}
        />
      </div>

      {/* Main Content Layout: Coverage Matrix + Architecture & Activity Stream */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Translation Coverage Card */}
        <Card
          style={{ '--stagger': 4 } as React.CSSProperties}
          className="animate-stage-in relative min-w-0 overflow-hidden shadow-xs"
        >
          <div
            className="animate-meridian-stream absolute inset-x-0 top-0 h-px"
            aria-hidden="true"
          />
          <CardHeader>
            <CardTitle>
              <h2>Translation coverage</h2>
            </CardTitle>
            <CardDescription>Filled working-copy text in each target language.</CardDescription>
            {overallPercent != null ? (
              <CardAction>
                <Badge
                  variant="secondary"
                  className="rounded-md border border-primary/25 bg-primary/10 font-mono text-xs font-semibold tabular-nums text-primary"
                >
                  {overallPercent}% overall
                </Badge>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            {/* Base language highlight pill */}
            <div className="relative flex flex-wrap items-center justify-between gap-2 overflow-hidden rounded-lg border border-border/75 bg-muted/30 px-3.5 py-3">
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-primary"
              />
              <div className="flex min-w-0 flex-col gap-0.5 pl-1">
                <p className="eyebrow text-[10px]">Base language</p>
                <p className="font-semibold text-foreground wrap-anywhere">
                  {languageName(project.base_language)}
                </p>
              </div>
              <Badge
                variant="secondary"
                className="rounded-md border border-primary/25 bg-primary/10 font-mono text-xs font-semibold text-primary"
              >
                {project.base_language.toUpperCase()}
              </Badge>
            </div>

            {targetLocales.length > 0 ? (
              <ul className="min-w-0 divide-y divide-border/60">
                {targetLocales.map((locale) => (
                  <LanguageCoverage
                    key={locale}
                    projectRef={projectRef}
                    locale={locale}
                    name={languageName(locale)}
                    total={total}
                    missing={coverageByLocale.get(locale)?.missing}
                    unavailable={coverage.isError && !coverage.data}
                    onRetry={() => void coverage.refetch()}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Globe2 />}
                title="Add a target language"
                description="Choose the languages you want to translate into in project settings."
                className="py-6"
              />
            )}
          </CardContent>
          <CardFooter className="flex-wrap justify-between gap-2 border-t border-border/50 bg-muted/20">
            <p className="text-xs text-muted-foreground">Draft and public strings.</p>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/projects/$projectRef/settings" params={{ projectRef }}>
                Manage languages
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </CardFooter>
        </Card>

        {/* Right Column: Recent Activity & Catalog Architecture */}
        <div
          className="animate-stage-in flex flex-col gap-6"
          style={{ '--stagger': 5 } as React.CSSProperties}
        >
          {/* Recent Activity Card */}
          <Card size="sm" className="min-w-0 shadow-xs">
            <CardHeader className="items-center">
              <CardTitle>
                <h2>Recent activity</h2>
              </CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/projects/$projectRef/activity" params={{ projectRef }} search={{}}>
                    View all
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {activity.data?.items.length ? (
                <div className="flex min-w-0 flex-col divide-y divide-border/60">
                  {activity.data.items.map((card) => (
                    <ActivityCard key={card.id} card={card} projectId={projectRef} compact />
                  ))}
                </div>
              ) : activity.isPending ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : activity.isError ? (
                <EmptyState
                  title="Couldn’t load activity"
                  description="Try loading the latest changes again."
                  action={
                    <Button variant="outline" size="sm" onClick={() => void activity.refetch()}>
                      Retry
                    </Button>
                  }
                  className="py-3"
                />
              ) : (
                <EmptyState
                  title="No activity yet"
                  description="Your catalog changes will appear here as you work."
                  className="py-3"
                />
              )}
            </CardContent>
          </Card>

          {/* Catalog Structure & Export Architecture Card */}
          <Card size="sm" className="min-w-0 shadow-xs">
            <CardHeader>
              <CardTitle>
                <h2>Catalog structure</h2>
              </CardTitle>
              <CardDescription>Organization, taxonomy, and export layout.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2.5">
              <Link
                to="/projects/$projectRef/modules"
                params={{ projectRef }}
                className="group flex flex-col justify-between gap-2 rounded-lg border border-border/75 bg-muted/25 p-3 transition-all duration-200 hover:border-primary/40 hover:bg-primary/[0.04]"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <Boxes className="size-4 text-primary" />
                  <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-foreground">
                    {modulesResult.data ? `${modulesResult.data.length} modules` : 'Modules'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Feature namespaces</p>
                </div>
              </Link>

              <Link
                to="/projects/$projectRef/tags"
                params={{ projectRef }}
                className="group flex flex-col justify-between gap-2 rounded-lg border border-border/75 bg-muted/25 p-3 transition-all duration-200 hover:border-primary/40 hover:bg-primary/[0.04]"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <Tags className="size-4 text-primary" />
                  <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-foreground">
                    {tagsResult.data ? `${tagsResult.data.length} tags` : 'Tags'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Cross-cutting labels</p>
                </div>
              </Link>

              <div className="flex flex-col justify-between gap-1.5 rounded-lg border border-border/75 bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-[10px]">Export shape</span>
                  <Layers className="size-3.5 text-muted-foreground" />
                </div>
                <p className="font-mono text-xs font-medium text-foreground">
                  {project.layout === 'modular' ? 'Modular' : 'Flat'} export layout
                </p>
              </div>

              <div className="flex flex-col justify-between gap-1.5 rounded-lg border border-border/75 bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-[10px]">Key policy</span>
                  <KeyRound className="size-3.5 text-muted-foreground" />
                </div>
                <p className="font-mono text-xs font-medium text-foreground">
                  {project.allow_duplicate_keys ? 'Per-module keys' : 'Unique project keys'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageBody>
  )
}
