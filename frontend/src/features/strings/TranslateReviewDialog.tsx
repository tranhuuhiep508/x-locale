import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { useEffect, useState } from 'react'
import { Check, Wand2 } from 'lucide-react'
import type { Job, TranslateJobProgress, TranslateProposalItem, TranslationSourceConflict } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DataPagination } from '@/components/ui/data-pagination'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ConfidenceBadge } from '@/features/strings/confidence'
import { describedByFor, QaCountBadges, QaIssueList, QaLocaleBadge } from '@/features/strings/qa-issue-view'
import {
  issueCounts,
  presentQaIssues,
  shouldFoldCleanLocales,
  shouldShowQaIndex,
  type QaBaseline,
  type QaFilter,
  type QaView,
} from '@/features/strings/qa-issues'
import {
  type DescriptionConflict,
  draftsFromItems,
  filledCount,
  localeCount,
  reviewStatusDescription,
  translateProgressLabel,
  translateProgressPercent,
  updateDraftDescription,
  updateDraftTranslation,
} from '@/features/strings/translate-review'
import { useQaWatch, type QaWatchRow } from '@/features/strings/use-qa-watch'
import { cn } from '@/lib/utils'

export function proposalsFromJobResult(
  result: Record<string, unknown> | null | undefined
): TranslateProposalItem[] {
  if (!result || !Array.isArray(result.items)) return []
  return result.items as TranslateProposalItem[]
}

export function jobStillRunning(job: Job | undefined): boolean {
  if (!job) return true
  return job.status !== 'completed' && job.status !== 'failed'
}

const UNCHECKED: QaView = { status: 'unchecked', issues: [], stale: false }

function qaId(stringId: string, locale: string): string {
  return `${stringId}:${locale}`
}

function qaRowsFor(drafts: TranslateProposalItem[], originals: TranslateProposalItem[]): QaWatchRow[] {
  const byId = new Map(originals.map((item) => [item.string_id, item]))
  return drafts.flatMap((draft) =>
    Object.keys(draft.translations).map((locale) => {
      const original = byId.get(draft.string_id)
      const baseline: QaBaseline = {
        source: original?.source_text ?? draft.source_text,
        text: original?.translations[locale] ?? '',
      }
      if (original?.issues && locale in original.issues) baseline.issues = original.issues[locale]
      return {
        id: qaId(draft.string_id, locale),
        locale,
        source: draft.source_text,
        text: draft.translations[locale] ?? '',
        baseline,
      }
    }),
  )
}

function localeView(qa: Record<string, QaView>, stringId: string, locale: string): QaView {
  return qa[qaId(stringId, locale)] ?? UNCHECKED
}

function stringViews(item: TranslateProposalItem, qa: Record<string, QaView>): QaView[] {
  return Object.keys(item.translations).map((locale) => localeView(qa, item.string_id, locale))
}

function tally(views: readonly QaView[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const view of views) {
    const counts = issueCounts(presentQaIssues(view.issues))
    errors += counts.errors
    warnings += counts.warnings
  }
  return { errors, warnings }
}

function filledViews(items: TranslateProposalItem[], qa: Record<string, QaView>): QaView[] {
  const views: QaView[] = []
  for (const item of items) {
    for (const [locale, text] of Object.entries(item.translations)) {
      if (!text.trim()) continue
      views.push(localeView(qa, item.string_id, locale))
    }
  }
  return views
}

function ProposalLocaleField({
  stringId,
  locale,
  value,
  score,
  view,
  foldClean,
  disabled,
  onChange,
}: {
  stringId: string
  locale: string
  value: string
  score: number | undefined
  view: QaView
  foldClean: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const inputId = `proposal-${stringId}-${locale}`
  const issuesId = `qa-${stringId}-${locale}`
  const presented = presentQaIssues(view.issues)
  const clean = view.status === 'ready' && !view.stale && presented.length === 0
  const folded = foldClean && clean && !expanded
  return (
    <Field className="rounded-lg border border-border/60 bg-muted/20 p-2.5" data-qa-status={view.status}>
      <div className="flex items-center gap-2">
        <FieldLabel htmlFor={folded ? undefined : inputId} className="uppercase font-mono text-xs font-semibold">
          {locale}
        </FieldLabel>
        <ConfidenceBadge score={score} />
        <span className="ml-auto">
          <QaLocaleBadge view={view} />
        </span>
      </div>
      {folded ? (
        <button
          type="button"
          className="mt-1 block w-full truncate text-left text-xs text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          {value}
        </button>
      ) : (
        <Textarea
          id={inputId}
          className="mt-1 min-h-12 resize-none text-xs"
          value={value}
          rows={2}
          disabled={disabled}
          autoComplete="off"
          spellCheck
          aria-describedby={describedByFor(view, issuesId)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <QaIssueList view={view} id={issuesId} />
    </Field>
  )
}

function ProposalTreeNode({
  item,
  review,
  disabled,
  qa,
  foldClean,
  onChange,
  onDescriptionChange,
  conflict,
  onResolveConflict,
  sourceConflict,
  onRemove,
}: {
  item: TranslateProposalItem
  review: boolean
  disabled: boolean
  qa: Record<string, QaView>
  foldClean: boolean
  onChange: (stringId: string, locale: string, value: string) => void
  onDescriptionChange: (stringId: string, description: string) => void
  conflict?: DescriptionConflict
  onResolveConflict: (conflict: DescriptionConflict, useLatest: boolean) => void
  sourceConflict?: TranslationSourceConflict
  onRemove: () => void
}) {
  const locales = Object.entries(item.translations)
  const descriptionId = `proposal-description-${item.string_id}`
  const rollup = tally(stringViews(item, qa))

  return (
    <li
      id={`proposal-${item.string_id}`}
      className={cn(
        'grid min-w-0 gap-4 rounded-xl border border-border/80 bg-card p-4.5 shadow-2xs transition-all',
        review && 'sm:grid-cols-2'
      )}
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Source text</span>
            <span className="flex items-center gap-1.5">
              {review ? <QaCountBadges errors={rollup.errors} warnings={rollup.warnings} showClean={false} /> : null}
              {item.status === 'public' ? (
                <Badge variant="outline" className="font-mono text-[10px] uppercase">Public</Badge>
              ) : null}
            </span>
          </div>
          <p className="font-medium whitespace-pre-wrap wrap-anywhere text-foreground text-sm leading-relaxed">{item.source_text}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs break-all text-muted-foreground rounded bg-muted/60 px-1.5 py-0.5" translate="no">
              {item.key}
            </code>
          </div>
        </div>

        <Field>
          <FieldLabel htmlFor={descriptionId} className="text-xs">Description</FieldLabel>
          <Textarea
            id={descriptionId}
            className="min-h-12 resize-none text-xs"
            value={item.description ?? ''}
            rows={2}
            disabled={disabled}
            autoComplete="off"
            placeholder="Context for a better translation"
            onChange={(e) => onDescriptionChange(item.string_id, e.target.value)}
          />
        </Field>
        {sourceConflict ? (
          <Alert variant="destructive">
            <AlertTitle>Source text changed since generation</AlertTitle>
            <AlertDescription>
              <p className="whitespace-pre-wrap">Reviewed source: {sourceConflict.expected_source_text}</p>
              <p className="whitespace-pre-wrap">Latest saved source: {sourceConflict.source_text}</p>
              <p>Nothing from this Apply was saved. Regenerate changed strings before applying again.</p>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRemove}>Remove from review</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {conflict ? (
          <Alert variant="destructive">
            <AlertTitle>Description changed since review opened</AlertTitle>
            <AlertDescription>
              <p>Latest saved description: {conflict.description ?? '(empty)'}</p>
              <p>Your draft is shown above. Choose which description to use, then Apply again.</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onResolveConflict(conflict, true)}>Use latest</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onResolveConflict(conflict, false)}>Keep mine</Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <FieldGroup
        className={cn(
          'min-w-0 gap-3',
          review && 'border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4.5 sm:border-border/60'
        )}
        aria-label={`Translations for ${item.key}`}
      >
        {review ? (
          locales.map(([locale, value]) => (
            <ProposalLocaleField
              key={locale}
              stringId={item.string_id}
              locale={locale}
              value={value}
              score={item.scores?.[locale]}
              view={localeView(qa, item.string_id, locale)}
              foldClean={foldClean}
              disabled={disabled}
              onChange={(next) => onChange(item.string_id, locale, next)}
            />
          ))
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {locales.map(([locale]) => (
              <Badge key={locale} variant="outline" className="uppercase font-mono">
                {locale}
              </Badge>
            ))}
          </div>
        )}
      </FieldGroup>
    </li>
  )
}

function QaIndex({
  items,
  qa,
}: {
  items: TranslateProposalItem[]
  qa: Record<string, QaView>
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs">
      <div className="border-b px-3.5 py-2">
        <span className="eyebrow">QA</span>
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((item) => {
          const views = stringViews(item, qa)
          const counts = tally(views)
          const flagged = Object.keys(item.translations).filter((locale) => {
            const shown = presentQaIssues(localeView(qa, item.string_id, locale).issues)
            return shown.length > 0
          })
          return (
            <li key={item.string_id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3.5 py-1.5 text-left hover:bg-accent/60"
                onClick={() => document.getElementById(`proposal-${item.string_id}`)?.scrollIntoView({ block: 'nearest' })}
              >
                <code className="font-mono text-xs" translate="no">{item.key}</code>
                {flagged.map((locale) => (
                  <span key={locale} className="font-mono text-[10px] uppercase text-muted-foreground">{locale}</span>
                ))}
                <span className="ml-auto">
                  <QaCountBadges errors={counts.errors} warnings={counts.warnings} showClean={false} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function TranslateReviewDialog({
  open,
  projectId,
  loadingQueue,
  generating,
  applying,
  generated,
  error,
  items,
  page,
  pageSize,
  total,
  onPageChange,
  onClose,
  onTranslate,
  onApply,
  progress,
  conflicts = [],
  onResolveConflict,
  sourceConflicts = [],
  recoveryMessage,
  onRegenerate,
  onRemoveFromReview,
}: {
  open: boolean
  projectId: string
  loadingQueue: boolean
  generating: boolean
  applying: boolean
  generated: boolean
  error: string | null
  items: TranslateProposalItem[]
  page: number
  pageSize: number
  total: number
  progress?: TranslateJobProgress | null
  onPageChange: (page: number) => void
  onClose: () => void
  onTranslate: (items: TranslateProposalItem[]) => void
  onApply: (items: TranslateProposalItem[]) => void
  conflicts?: DescriptionConflict[]
  onResolveConflict?: (conflict: DescriptionConflict) => void
  sourceConflicts?: TranslationSourceConflict[]
  recoveryMessage?: string | null
  onRegenerate?: (items: TranslateProposalItem[]) => void
  onRemoveFromReview?: (items: TranslateProposalItem[], stringId: string) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, TranslateProposalItem>>(() =>
    draftsFromItems(items)
  )
  const [filter, setFilter] = useState<QaFilter>('all')

  useEffect(() => {
    setDrafts(draftsFromItems(items))
  }, [items])

  const draftList = items.flatMap((item) => {
    const draft = drafts[item.string_id]
    return draft ? [draft] : []
  })
  const publicCount = draftList.filter((item) => item.status === 'public').length
  const missingCount = localeCount(draftList)
  const applyCount = filledCount(draftList)
  const review = generated && !generating
  const busy = loadingQueue || generating || applying
  const canTranslate = !busy && draftList.length > 0 && conflicts.length === 0 && sourceConflicts.length === 0
  const canApply = review && !busy && applyCount > 0 && !error && conflicts.length === 0 && sourceConflicts.length === 0
  const canPage = total > pageSize
  const pagingInPlace = loadingQueue && draftList.length > 0
  const showInitialSpinner = loadingQueue && draftList.length === 0
  const generatingLabel = translateProgressLabel(progress)
  const generatingPercent = translateProgressPercent(progress)
  const description = reviewStatusDescription({
    loadingInitial: showInitialSpinner,
    total,
    pageStringCount: draftList.length,
    missingCount,
    applyCount,
    generated,
  })
  const qa = useQaWatch(projectId, qaRowsFor(draftList, items), open && review)
  const pageViews = filledViews(draftList, qa)
  const pageCounts = tally(pageViews)
  const checking = pageViews.some((view) => view.status === 'checking')
  const unchecked = pageViews.some((view) => view.status === 'unchecked')
  const pageClean = !checking && !unchecked && pageViews.length > 0
    && pageCounts.errors === 0 && pageCounts.warnings === 0
  const withIssues = draftList.filter((item) => {
    const counts = tally(stringViews(item, qa))
    return counts.errors + counts.warnings > 0
  })
  const withErrors = draftList.filter((item) => tally(stringViews(item, qa)).errors > 0)
  const visible = filter === 'errors' ? withErrors : filter === 'issues' ? withIssues : draftList
  const foldClean = shouldFoldCleanLocales(draftList.length)

  useEffect(() => {
    if (filter === 'errors' && withErrors.length === 0) setFilter('all')
    else if (filter === 'issues' && withIssues.length === 0) setFilter('all')
  }, [filter, withErrors.length, withIssues.length])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying && !generating) onClose()
      }}
    >
      <ReviewDialogContent>
        <ReviewDialogHeader>
          <DialogTitle>{generated ? 'Review Translations' : 'Missing Translations'}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {review && draftList.length > 0 ? (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">QA</span>
                {checking ? <span className="text-xs text-muted-foreground">Checking…</span> : null}
                <QaCountBadges
                  errors={pageCounts.errors}
                  warnings={pageCounts.warnings}
                  showClean={pageClean}
                />
                <span className="text-xs text-muted-foreground">
                  {pageClean
                    ? `on ${draftList.length} ${draftList.length === 1 ? 'string' : 'strings'}`
                    : `in ${withIssues.length} of ${draftList.length} ${draftList.length === 1 ? 'string' : 'strings'}`}
                </span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={filter}
                  onValueChange={(value) => {
                    if (value === 'all' || value === 'issues' || value === 'errors') setFilter(value)
                  }}
                  className="ml-auto"
                  aria-label="Filter QA results"
                >
                  <ToggleGroupItem value="all">All {draftList.length}</ToggleGroupItem>
                  <ToggleGroupItem value="issues" disabled={withIssues.length === 0}>
                    With issues {withIssues.length}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="errors" disabled={withErrors.length === 0}>
                    Errors {withErrors.length}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <p className="text-xs text-muted-foreground">
                QA checks are advisory. They never block Apply or Publish.
              </p>
            </div>
          ) : null}
          {generating ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <p className="text-sm text-muted-foreground">{generatingLabel}</p>
              <Progress
                value={generatingPercent}
                aria-label={generatingLabel}
                aria-valuetext={generatingLabel}
                className={generatingPercent == null ? 'animate-pulse' : undefined}
              />
            </div>
          ) : null}
          {error && !loadingQueue ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : publicCount > 0 && !loadingQueue ? (
            <p className="text-sm text-muted-foreground">
              {publicCount} public {publicCount === 1 ? 'string is' : 'strings are'} in this list.
              Applied values stay in the working copy until you publish.
            </p>
          ) : null}
          {recoveryMessage ? <p className="text-sm text-destructive" role="status">{recoveryMessage}</p> : null}
        </ReviewDialogHeader>

        <ReviewDialogBody>
          {showInitialSpinner ? (
            <div
              className="flex h-52 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <Spinner />
              Loading missing strings…
            </div>
          ) : error && draftList.length === 0 ? (
            <EmptyState title="Translation failed" description={error} />
          ) : draftList.length === 0 ? (
            <EmptyState
              title="Nothing to translate"
              description="Every target locale already has text."
            />
          ) : (
            <div className="relative flex flex-col gap-3" aria-busy={pagingInPlace || generating}>
              {pagingInPlace ? (
                <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/60 pt-16">
                  <Spinner />
                </div>
              ) : null}
              {shouldShowQaIndex(draftList.length, filter) ? (
                <QaIndex items={visible} qa={qa} />
              ) : null}
              <ul
                className={cn(
                  'flex flex-col gap-3',
                  pagingInPlace && 'pointer-events-none opacity-60'
                )}
              >
                {visible.map((item) => (
                  <ProposalTreeNode
                    key={item.string_id}
                    item={item}
                    qa={qa}
                    foldClean={foldClean}
                    conflict={conflicts.find((conflict) => conflict.string_id === item.string_id)}
                    sourceConflict={sourceConflicts.find((conflict) => conflict.string_id === item.string_id)}
                    onRemove={() => onRemoveFromReview?.(draftList, item.string_id)}
                    onResolveConflict={(conflict, useLatest) => {
                      if (useLatest) {
                        setDrafts((prev) => updateDraftDescription(prev, conflict.string_id, conflict.description ?? ''))
                      }
                      onResolveConflict?.(conflict)
                    }}
                    review={review}
                    disabled={applying || generating || pagingInPlace}
                    onChange={(stringId, locale, value) =>
                      setDrafts((prev) => updateDraftTranslation(prev, stringId, locale, value))
                    }
                    onDescriptionChange={(stringId, nextDescription) =>
                      setDrafts((prev) => updateDraftDescription(prev, stringId, nextDescription))
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </ReviewDialogBody>

        {canPage ? (
          <div className="shrink-0 border-t px-5">
            <DataPagination
              page={page}
              pageSize={pageSize}
              total={total}
              disabled={busy}
              onPageChange={onPageChange}
            />
          </div>
        ) : null}

        <ReviewDialogFooter>
          {review && pageCounts.errors > 0 ? (
            <p className="mr-auto text-xs text-muted-foreground">
              {pageCounts.errors === 1 ? '1 QA error' : `${pageCounts.errors} QA errors`}. You can still apply.
            </p>
          ) : null}
          <Button
            variant="outline"
            type="button"
            onClick={onClose}
            disabled={applying || generating}
          >
            Discard
          </Button>
          {sourceConflicts.length > 0 ? (
            <Button type="button" disabled={busy} onClick={() => onRegenerate?.(draftList)}>
              {generating ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
              Regenerate changed strings
            </Button>
          ) : null}
          <Button
            variant={review ? 'outline' : 'default'}
            type="button"
            disabled={!canTranslate}
            onClick={() => onTranslate(draftList)}
          >
            {generating ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
            {review ? 'Translate again' : 'Translate'}
          </Button>
          {review ? (
            <Button type="button" disabled={!canApply} onClick={() => onApply(draftList)}>
              {applying ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
              Apply {applyCount === 1 ? '1 translation' : `${applyCount} translations`}
            </Button>
          ) : null}
        </ReviewDialogFooter>
      </ReviewDialogContent>
    </Dialog>
  )
}
