import { getRouteApi, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ElementType } from 'react'
import {
  AlignLeft,
  ArrowRight,
  ArrowUpRight,
  GitCompareArrows,
  Globe2,
  Settings2,
  Layers,
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
import { Separator } from '@/components/ui/separator'
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
}: {
  icon: ElementType
  label: string
  value: number | string | undefined
  description: string
  projectRef: string
  to: '/projects/$projectRef/strings' | '/projects/$projectRef/settings'
  search?: StringsSearch
  accent?: boolean
}) {
  return (
    <Link
      to={to}
      params={{ projectRef }}
      search={search}
      className="group relative min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        size="sm"
        className={`h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
          accent ? 'border-primary/40 bg-primary/5' : ''
        }`}
      >
        <CardHeader>
          <CardDescription className="min-h-10 sm:min-h-5 font-medium">{label}</CardDescription>
          <CardAction className="hidden sm:block">
            <MarkWell className={accent ? 'bg-primary/20 text-primary ring-primary/30' : ''}>
              <Icon className="size-4" />
            </MarkWell>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            {value === undefined ? (
              <Skeleton className="h-8 w-12" aria-label={`Loading ${label.toLowerCase()}`} />
            ) : (
              <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-3xl">
                {value}
              </p>
            )}
            <ArrowUpRight
              aria-hidden="true"
              className="hidden size-4 text-muted-foreground transition-all duration-200 group-hover:translate-x-0.5 group-hover:translate-y-[-1px] group-hover:text-primary sm:block"
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
    <li className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Badge variant="outline" className="font-mono text-xs font-semibold">
            {locale.toUpperCase()}
          </Badge>
          <h3 className="min-w-0 font-medium text-foreground wrap-anywhere">{name}</h3>
        </div>
        {percent == null ? (
          unavailable ? (
            <span className="text-xs text-muted-foreground">Unavailable</span>
          ) : (
            <Skeleton className="h-5 w-10" />
          )
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums text-foreground">{percent}%</span>
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
        <p className="text-xs tabular-nums text-muted-foreground">
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
              className="text-xs font-medium hover:text-primary transition-colors"
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
  const coverageByLocale = new Map(coverage.data?.locales.map((row) => [row.locale, row]))
  const languageName = (locale: string) =>
    languages.find((language) => language.code === locale)?.name ?? locale

  return (
    <PageBody className="mx-auto w-full max-w-7xl pb-16">
      {/* Overview Page Header */}
      <PageHeader
        eyebrow="Project"
        title="Overview"
        description={project.name}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/projects/$projectRef/settings" params={{ projectRef }}>
                <Settings2 data-icon="inline-start" />
                Settings
              </Link>
            </Button>
            <Button asChild className="shadow-xs">
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
        />
        <StatCard
          icon={Globe2}
          label="Languages"
          value={project.target_languages.length}
          description="Target languages"
          projectRef={projectRef}
          to="/projects/$projectRef/settings"
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
        />
      </div>

      {/* Main Content Layout: Coverage Matrix + Activity Stream & CLI */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Translation Coverage Card */}
        <Card className="min-w-0 overflow-hidden shadow-xs">
          <CardHeader>
            <CardTitle>
              <h2>Translation coverage</h2>
            </CardTitle>
            <CardDescription>Filled working-copy text in each target language.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            {/* Base language highlight pill */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/30 px-3.5 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="eyebrow text-[10px]">Base language</p>
                <p className="font-semibold text-foreground wrap-anywhere">
                  {languageName(project.base_language)}
                </p>
              </div>
              <Badge variant="secondary" className="font-mono text-xs font-semibold">
                {project.base_language.toUpperCase()}
              </Badge>
            </div>

            {project.target_languages.length > 0 ? (
              <ul className="min-w-0 divide-y divide-border/60">
                {project.target_languages.map((locale) => (
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

        {/* Right Column: Recent Activity */}
        <div className="space-y-6">
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
        </div>
      </div>

      {/* Overview Footer Metadata Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Link
            to="/projects/$projectRef/modules"
            params={{ projectRef }}
            className="hover:text-foreground hover:underline transition-colors flex items-center gap-1.5"
          >
            <Layers className="size-3 text-primary" />
            {modulesResult.data ? `${modulesResult.data.length} modules` : 'Modules'}
          </Link>
          <Separator orientation="vertical" className="h-3" />
          <Link
            to="/projects/$projectRef/tags"
            params={{ projectRef }}
            className="hover:text-foreground hover:underline transition-colors"
          >
            {tagsResult.data ? `${tagsResult.data.length} tags` : 'Tags'}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            {project.layout === 'modular' ? 'Modular' : 'Flat'} export layout
          </Badge>
        </div>
      </div>
    </PageBody>
  )
}
