import { useMemo, useState } from 'react'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ElementType } from 'react'
import {
  AlignLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  GitCompareArrows,
  Globe2,
  KeyRound,
  Layers,
  Settings2,
  Sparkles,
  Tags,
  Upload,
} from 'lucide-react'
import { ActivityCard } from '@/features/activity/ActivityCard'
import { tagSwatchColor } from '@/features/strings/catalog-create'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageBody, PageHeader, PageStickyHeader } from '@/components/layout/PageHeader'
import type { LocaleCoverage, Module, Project, Tag } from '@/lib/api/types'
import type { StringsSearch } from '@/lib/schemas'

const routeApi = getRouteApi('/projects/$projectRef/')

type CoverageFilter = 'all' | 'incomplete' | 'complete'

type DispatchState = {
  tone: 'neutral' | 'active' | 'amber' | 'complete'
  badge: string
  summary: string
  ctaLabel: string
  ctaIcon: ElementType
  ctaTo:
    | '/projects/$projectRef/strings'
    | '/projects/$projectRef/settings'
    | '/projects/$projectRef/import-export'
  ctaSearch?: StringsSearch
}

function deriveDispatchState({
  total,
  targetCount,
  pendingCount,
  totalMissing,
  incompleteCount,
  overallPercent,
}: {
  total: number
  targetCount: number
  pendingCount: number
  totalMissing: number
  incompleteCount: number
  overallPercent: number | null
}): DispatchState {
  if (total === 0) {
    return {
      tone: 'neutral',
      badge: 'Empty catalog',
      summary: 'Import existing locale files or add your first string key to start translating.',
      ctaLabel: 'Import strings',
      ctaIcon: Upload,
      ctaTo: '/projects/$projectRef/import-export',
    }
  }

  if (targetCount === 0) {
    return {
      tone: 'neutral',
      badge: 'Target languages needed',
      summary: 'Choose target languages in settings to track translation progress across locales.',
      ctaLabel: 'Choose languages',
      ctaIcon: Globe2,
      ctaTo: '/projects/$projectRef/settings',
    }
  }

  if (pendingCount > 0) {
    const missingClause =
      totalMissing > 0
        ? ` and ${totalMissing} missing translation${totalMissing === 1 ? '' : 's'} remaining`
        : ', with all target languages translated'
    return {
      tone: 'amber',
      badge: 'Publish queue active',
      summary: `${pendingCount} string${pendingCount === 1 ? '' : 's'} queued with unpublished edits${missingClause}.`,
      ctaLabel: `Review publish queue (${pendingCount})`,
      ctaIcon: GitCompareArrows,
      ctaTo: '/projects/$projectRef/strings',
      ctaSearch: { has_unpublished_changes: true },
    }
  }

  if (totalMissing > 0) {
    return {
      tone: 'active',
      badge: 'In translation',
      summary: `${totalMissing} missing translation${totalMissing === 1 ? '' : 's'} across ${incompleteCount} target language${incompleteCount === 1 ? '' : 's'}.`,
      ctaLabel: `Fill ${totalMissing} missing`,
      ctaIcon: Sparkles,
      ctaTo: '/projects/$projectRef/strings',
      ctaSearch: { missing_any: true },
    }
  }

  if (overallPercent === 100) {
    return {
      tone: 'complete',
      badge: 'Edition aligned',
      summary: `All ${targetCount} target language${targetCount === 1 ? '' : 's'} are 100% translated across ${total} strings.`,
      ctaLabel: 'Export locale files',
      ctaIcon: ArrowRight,
      ctaTo: '/projects/$projectRef/import-export',
    }
  }

  return {
    tone: 'active',
    badge: 'Active workspace',
    summary: `Tracking ${total} strings across ${targetCount} target language${targetCount === 1 ? '' : 's'}.`,
    ctaLabel: 'Browse catalog',
    ctaIcon: ArrowRight,
    ctaTo: '/projects/$projectRef/strings',
    ctaSearch: {},
  }
}

const TONE_DOT_CLASS: Record<DispatchState['tone'], string> = {
  neutral: 'bg-muted-foreground/70',
  active: 'bg-primary',
  amber: 'bg-primary',
  complete: 'bg-primary',
}

function TelemetryCell({
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
      className="group relative flex min-w-0 flex-col justify-between gap-2 px-5 py-4 outline-none transition-colors duration-200 hover:bg-muted/45 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow inline-flex items-center gap-1.5">
          <Icon className={`size-3.5 transition-colors ${accent ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
          <span>{label}</span>
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-3.5 text-muted-foreground/75 transition-transform duration-200 ease-drift group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
        />
      </div>

      <div className="flex items-baseline justify-between gap-3">
        {value === undefined ? (
          <Skeleton className="h-7 w-12" aria-label={`Loading ${label.toLowerCase()}`} />
        ) : (
          <span className="font-heading text-2xl font-bold tracking-tight tabular-nums text-foreground">
            {value}
          </span>
        )}
        <span className="truncate text-xs text-muted-foreground">{description}</span>
      </div>
    </Link>
  )
}

function LocaleHorizonStrip({
  projectRef,
  targetLocales,
  total,
  coverageByLocale,
  languageName,
}: {
  projectRef: string
  targetLocales: string[]
  total: number
  coverageByLocale: Map<string, LocaleCoverage>
  languageName: (locale: string) => string
}) {
  if (targetLocales.length === 0 || total === 0) return null

  if (targetLocales.length <= 12) {
    return (
      <div
        aria-label="Language completion summary"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
      >
        {targetLocales.map((locale) => {
          const missing = coverageByLocale.get(locale)?.missing
          const translated = missing == null ? 0 : Math.max(0, total - missing)
          const percent = missing == null ? 0 : Math.round((translated / total) * 100)
          const isComplete = missing === 0

          return (
            <Link
              key={locale}
              to="/projects/$projectRef/strings"
              params={{ projectRef }}
              search={isComplete ? { complete_locale: locale } : { missing_locale: locale }}
              aria-label={`${languageName(locale)}: ${percent}% translated`}
              className="group flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/75 bg-background/75 px-2.5 py-2 transition-colors hover:border-primary/45 hover:bg-background"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-mono text-2xs font-semibold uppercase text-foreground">
                  {locale}
                </span>
                <span
                  className={`font-mono text-2xs font-medium tabular-nums ${
                    isComplete
                      ? 'text-primary'
                      : percent === 0
                        ? 'text-muted-foreground'
                        : 'text-foreground'
                  }`}
                >
                  {percent}%
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isComplete ? 'bg-primary' : 'bg-primary/70'
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </Link>
          )
        })}
      </div>
    )
  }

  let complete = 0
  let inProgress = 0
  let untouched = 0
  for (const locale of targetLocales) {
    const missing = coverageByLocale.get(locale)?.missing
    if (missing === 0) complete += 1
    else if (missing != null && missing < total) inProgress += 1
    else untouched += 1
  }

  const completePct = (complete / targetLocales.length) * 100
  const inProgressPct = (inProgress / targetLocales.length) * 100
  const untouchedPct = (untouched / targetLocales.length) * 100

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {completePct > 0 ? (
          <div className="h-full bg-primary" style={{ width: `${completePct}%` }} />
        ) : null}
        {inProgressPct > 0 ? (
          <div className="h-full bg-primary/45" style={{ width: `${inProgressPct}%` }} />
        ) : null}
        {untouchedPct > 0 ? (
          <div className="h-full bg-muted-foreground/20" style={{ width: `${untouchedPct}%` }} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          {complete} complete
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary/45" aria-hidden="true" />
          {inProgress} in progress
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          {untouched} empty
        </span>
      </div>
    </div>
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
  const isComplete = percent === 100 && total > 0

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Badge variant="outline" className="rounded-md bg-muted/40 font-mono text-xs font-semibold">
            {locale.toUpperCase()}
          </Badge>
          <h3 className="min-w-0 font-medium text-foreground wrap-anywhere">{name}</h3>
          {isComplete ? (
            <CheckCircle2
              aria-hidden="true"
              className="size-3.5 shrink-0 text-primary"
            />
          ) : null}
        </div>
        {percent == null ? (
          unavailable ? (
            <span className="font-mono text-xs text-muted-foreground">Unavailable</span>
          ) : (
            <Skeleton className="h-5 w-10" />
          )
        ) : (
          <span
            className={`font-heading text-sm font-semibold tabular-nums ${
              isComplete ? 'text-primary' : 'text-foreground'
            }`}
          >
            {percent}%
          </span>
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
              className="h-7 px-2 text-xs font-medium transition-colors hover:text-primary"
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

function CatalogBlueprintCard({
  projectRef,
  project,
  modules,
  tags,
}: {
  projectRef: string
  project: Project
  modules: Module[] | undefined
  tags: Tag[] | undefined
}) {
  const visibleModules = (modules ?? []).slice(0, 4)
  const extraModules = Math.max(0, (modules?.length ?? 0) - visibleModules.length)
  const visibleTags = (tags ?? []).slice(0, 5)
  const extraTags = Math.max(0, (tags?.length ?? 0) - visibleTags.length)

  return (
    <Card size="sm" className="min-w-0 overflow-hidden border-border/85 shadow-xs">
      <CardHeader>
        <CardTitle>
          <h2>Catalog blueprint</h2>
        </CardTitle>
        <CardDescription>Namespaces, taxonomy labels, and export policy.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2.5">
        <Link
          to="/projects/$projectRef/modules"
          params={{ projectRef }}
          className="group flex flex-col gap-2.5 rounded-xl border border-border/75 bg-muted/20 p-3.5 transition-all duration-200 hover:border-border hover:bg-muted/35"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors group-hover:text-primary">
                <Boxes className="size-3.5" aria-hidden="true" />
              </span>
              <span className="font-heading text-sm font-semibold text-foreground">
                {modules ? `${modules.length} module${modules.length === 1 ? '' : 's'}` : 'Modules'}
              </span>
            </div>
            <ArrowUpRight
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
            />
          </div>

          {visibleModules.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {visibleModules.map((mod) => (
                <span
                  key={mod.id}
                  className="rounded-md border border-border/70 bg-background/85 px-2 py-0.5 font-mono text-2xs text-foreground/85"
                >
                  {mod.slug}
                </span>
              ))}
              {extraModules > 0 ? (
                <span className="font-mono text-2xs text-muted-foreground">
                  +{extraModules} more
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Group strings by feature or screen for modular exports.
            </p>
          )}
        </Link>

        <Link
          to="/projects/$projectRef/tags"
          params={{ projectRef }}
          className="group flex flex-col gap-2.5 rounded-xl border border-border/75 bg-muted/20 p-3.5 transition-all duration-200 hover:border-border hover:bg-muted/35"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors group-hover:text-primary">
                <Tags className="size-3.5" aria-hidden="true" />
              </span>
              <span className="font-heading text-sm font-semibold text-foreground">
                {tags ? `${tags.length} tag${tags.length === 1 ? '' : 's'}` : 'Tags'}
              </span>
            </div>
            <ArrowUpRight
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
            />
          </div>

          {visibleTags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {visibleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/85 px-2 py-0.5 text-2xs font-medium text-foreground/90"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tagSwatchColor(tag.color) }}
                    aria-hidden="true"
                  />
                  <span>{tag.name}</span>
                </span>
              ))}
              {extraTags > 0 ? (
                <span className="font-mono text-2xs text-muted-foreground">
                  +{extraTags} more
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Label cross-cutting releases, UI surfaces, or review states.
            </p>
          )}
        </Link>
      </CardContent>

      <CardFooter className="grid grid-cols-2 gap-3 border-t border-border/60 bg-muted/20 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 eyebrow text-3xs">
            <Layers className="size-3" aria-hidden="true" />
            Export layout
          </span>
          <span className="truncate font-mono text-xs font-medium text-foreground">
            {project.layout === 'modular' ? 'Modular' : 'Flat'}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 eyebrow text-3xs">
            <KeyRound className="size-3" aria-hidden="true" />
            Key policy
          </span>
          <span className="truncate font-mono text-xs font-medium text-foreground">
            {project.allow_duplicate_keys ? 'Per-module keys' : 'Unique project keys'}
          </span>
        </div>
      </CardFooter>
    </Card>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border/80 bg-background/95">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Skeleton className="h-7 w-36" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <Skeleton className="h-52 w-full rounded-2xl" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export function ProjectOverviewPage() {
  const { projectRef } = routeApi.useParams()
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('all')

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

  const targetLocales = useMemo(
    () =>
      project ? project.target_languages.filter((locale) => locale !== project.base_language) : [],
    [project]
  )

  const coverageByLocale = useMemo(
    () => new Map(coverage.data?.locales.map((row) => [row.locale, row])),
    [coverage.data]
  )

  if (!project) {
    if (projectQueryResult.isError) {
      return (
        <PageBody>
          <EmptyState
            title="Couldn’t load this project"
            description="Try loading the overview again."
            action={
              <Button variant="outline" onClick={() => void projectQueryResult.refetch()}>
                Retry
              </Button>
            }
          />
        </PageBody>
      )
    }
    return <OverviewSkeleton />
  }

  const total = coverage.data?.total ?? project.string_count
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

  const pendingCount = publish.data?.total ?? 0
  const totalMissing = targetLocales.reduce(
    (sum, locale) => sum + (coverageByLocale.get(locale)?.missing ?? 0),
    0
  )
  const incompleteLocales = targetLocales.filter((locale) => {
    const missing = coverageByLocale.get(locale)?.missing
    return missing != null && missing > 0
  })

  const showCoverageFilter = targetLocales.length > 4 && Boolean(coverage.data) && total > 0
  const effectiveFilter = showCoverageFilter ? coverageFilter : 'all'
  const visibleLocales = targetLocales.filter((locale) => {
    if (effectiveFilter === 'all') return true
    const missing = coverageByLocale.get(locale)?.missing ?? 0
    return effectiveFilter === 'incomplete' ? missing > 0 : missing === 0
  })

  const dispatch = deriveDispatchState({
    total,
    targetCount: targetLocales.length,
    pendingCount,
    totalMissing,
    incompleteCount: incompleteLocales.length,
    overallPercent,
  })
  const DispatchCtaIcon = dispatch.ctaIcon

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageStickyHeader maxWidth="6xl">
        <PageHeader
          title="Overview"
          badge={
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-xs">
                {project.slug}
              </Badge>
              <Badge variant="secondary" className="capitalize">
                {project.layout} layout
              </Badge>
            </div>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
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
      </PageStickyHeader>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 pb-12 sm:px-6 sm:py-6">
        <section
          aria-label="Release readiness"
          style={{ '--stagger': 1 } as React.CSSProperties}
          className="galley-grid animate-stage-in relative overflow-hidden rounded-2xl border border-border/85 bg-card shadow-xs"
        >
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-col gap-2">
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/80 bg-background/90 px-2.5 py-0.5 text-xs font-medium text-foreground/85">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${TONE_DOT_CLASS[dispatch.tone]}`}
                  />
                  {dispatch.badge}
                </span>

                <h2 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl wrap-anywhere">
                  {project.name}
                </h2>

                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {dispatch.summary}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-start gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end">
                {overallPercent != null ? (
                  <div className="flex items-baseline gap-2">
                    <span className="font-heading text-3xl font-bold tracking-tight tabular-nums text-foreground">
                      {overallPercent}%
                    </span>
                    <span className="eyebrow">Translated</span>
                  </div>
                ) : null}

                <Button
                  size="sm"
                  variant={dispatch.tone === 'amber' ? 'default' : 'outline'}
                  asChild
                  className={
                    dispatch.tone === 'amber'
                      ? 'shadow-xs'
                      : 'border-border/85 bg-background/90 hover:border-primary/45'
                  }
                >
                  <Link
                    to={dispatch.ctaTo}
                    params={{ projectRef }}
                    search={dispatch.ctaSearch}
                  >
                    <DispatchCtaIcon data-icon="inline-start" />
                    {dispatch.ctaLabel}
                  </Link>
                </Button>
              </div>
            </div>

            {coverage.data ? (
              <LocaleHorizonStrip
                projectRef={projectRef}
                targetLocales={targetLocales}
                total={total}
                coverageByLocale={coverageByLocale}
                languageName={languageName}
              />
            ) : null}
          </div>

          <div className="grid grid-cols-1 divide-y divide-border/75 border-t border-border/75 bg-muted/25 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <TelemetryCell
              icon={AlignLeft}
              label="Strings"
              value={total}
              description="Browse your catalog"
              projectRef={projectRef}
              to="/projects/$projectRef/strings"
              search={{}}
            />
            <TelemetryCell
              icon={Globe2}
              label="Languages"
              value={targetLocales.length}
              description="Target languages"
              projectRef={projectRef}
              to="/projects/$projectRef/settings"
            />
            <TelemetryCell
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
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card
            style={{ '--stagger': 2 } as React.CSSProperties}
            className="animate-stage-in min-w-0 border-border/85 shadow-xs"
          >
            <CardHeader>
              <CardTitle>
                <h2>Translation coverage</h2>
              </CardTitle>
              <CardDescription>Filled working-copy text in each target language.</CardDescription>
              {showCoverageFilter ? (
                <CardAction>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={coverageFilter}
                    aria-label="Filter languages by completion"
                    onValueChange={(value) => {
                      if (value) setCoverageFilter(value as CoverageFilter)
                    }}
                  >
                    <ToggleGroupItem value="all" className="text-xs">
                      All ({targetLocales.length})
                    </ToggleGroupItem>
                    <ToggleGroupItem value="incomplete" className="text-xs">
                      Needs work ({incompleteLocales.length})
                    </ToggleGroupItem>
                    <ToggleGroupItem value="complete" className="text-xs">
                      Complete ({targetLocales.length - incompleteLocales.length})
                    </ToggleGroupItem>
                  </ToggleGroup>
                </CardAction>
              ) : null}
            </CardHeader>

            <CardContent className="flex min-w-0 flex-col gap-4">
              <div className="relative flex flex-wrap items-center justify-between gap-2 overflow-hidden rounded-xl border border-border/75 bg-muted/30 px-3.5 py-2.5">
                <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary" />
                <div className="flex min-w-0 flex-col gap-0.5 pl-1">
                  <p className="eyebrow text-3xs">Base language</p>
                  <p className="font-semibold text-foreground wrap-anywhere">
                    {languageName(project.base_language)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    Source of truth
                  </span>
                  <Badge
                    variant="secondary"
                    className="rounded-md border border-accent-foreground/25 bg-accent font-mono text-xs font-semibold text-accent-foreground"
                  >
                    {project.base_language.toUpperCase()}
                  </Badge>
                </div>
              </div>

              {targetLocales.length === 0 ? (
                <EmptyState
                  icon={<Globe2 />}
                  title="Add a target language"
                  description="Choose the languages you want to translate into in project settings."
                  className="py-6"
                />
              ) : visibleLocales.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    {coverageFilter === 'incomplete'
                      ? 'Every target language is 100% translated.'
                      : 'No target languages are 100% translated yet.'}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCoverageFilter('all')}
                  >
                    Show all languages
                  </Button>
                </div>
              ) : (
                <ul className="min-w-0 divide-y divide-border/55">
                  {visibleLocales.map((locale) => (
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

          <div
            className="animate-stage-in flex flex-col gap-6"
            style={{ '--stagger': 3 } as React.CSSProperties}
          >
            <Card size="sm" className="min-w-0 border-border/85 shadow-xs">
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
                  <div className="relative flex min-w-0 flex-col divide-y divide-border/55">
                    {activity.data.items.map((card) => (
                      <div key={card.id} className="relative flex min-w-0 items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-4 size-1.5 shrink-0 rounded-full bg-primary/55"
                        />
                        <div className="min-w-0 flex-1">
                          <ActivityCard card={card} projectId={projectRef} compact />
                        </div>
                      </div>
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

            <CatalogBlueprintCard
              projectRef={projectRef}
              project={project}
              modules={modulesResult.data}
              tags={tagsResult.data}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
