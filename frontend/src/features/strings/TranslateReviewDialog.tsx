import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, CheckCheck, Save, Send, Wand2 } from 'lucide-react'
import type {
  Job,
  StringEntry,
  TranslateJobProgress,
  TranslateProposalItem,
  TranslationMemoryMatch,
  TranslationSourceConflict,
} from '@/lib/api/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataPagination } from '@/components/ui/data-pagination'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { MatchBar } from '@/features/strings/translation-memory-view'
import { describedByFor, QA_APPLY_FOOTER, QaLocaleBadge } from '@/features/strings/qa-issue-view'
import type { QaBaseline, QaView } from '@/features/strings/qa-issues'
import {
  applyMemoryTranslation,
  draftsFromItems,
  filledCount,
  localeCount,
  reviewStatusDescription,
  translateProgressLabel,
  translateProgressPercent,
  updateDraftTranslation,
} from '@/features/strings/translate-review'
import { useQaWatch, type QaWatchRow } from '@/features/strings/use-qa-watch'
import { cn } from '@/lib/utils'
import { TranslatePublishReview } from '@/features/strings/TranslatePublishReview'

export function proposalsFromJobResult(
  result: Record<string, unknown> | null | undefined,
): TranslateProposalItem[] {
  if (!result || !Array.isArray(result.items)) return []
  return result.items as TranslateProposalItem[]
}

export function jobStillRunning(job: Job | undefined): boolean {
  if (!job) return true
  return job.status !== 'completed' && job.status !== 'failed'
}

const UNCHECKED: QaView = { status: 'unchecked', issues: [], stale: false }
const PAGE_BLOCKED = "Save or undo this page's changes first"

const reviewSteps = [
  { label: 'Translate', description: 'Generate or match translations' },
  { label: 'Review', description: 'Check and edit translations' },
  { label: 'Publish', description: 'Review public changes and publish' },
]

export function TranslateStepper({ current }: { current: number }) {
  return (
    <div
      role="group"
      aria-label="Translation progress"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-muted/40 p-1 text-xs"
    >
      {reviewSteps.map((step, index) => {
        const complete = index < current
        const active = index === current
        return (
          <div
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs transition-all',
              active
                ? 'bg-background font-semibold text-foreground shadow-xs ring-1 ring-border/50'
                : complete
                  ? 'font-medium text-primary'
                  : 'text-muted-foreground/60',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-3.5 items-center justify-center rounded-full font-mono text-[9px]',
                active
                  ? 'bg-primary font-bold text-primary-foreground'
                  : complete
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {complete ? <Check className="size-2.5 stroke-[2.5]" /> : index + 1}
            </span>
            <span className="font-medium">
              {step.label}
              <span className="sr-only">
                {complete ? ', complete' : active ? ', current step' : ', upcoming'}
              </span>
            </span>
            <span className="sr-only">{step.description}</span>
          </div>
        )
      })}
    </div>
  )
}

function sameSelection(draft: TranslateProposalItem, original: TranslateProposalItem): boolean {
  const left = draft.memory_selected ?? []
  const right = original.memory_selected ?? []
  return left.length === right.length && left.every((locale) => right.includes(locale))
}

function draftDiffers(
  draft: TranslateProposalItem,
  original: TranslateProposalItem | undefined,
): boolean {
  if (!original) return true
  if (!sameSelection(draft, original)) return true
  const locales = Object.keys(draft.translations)
  if (locales.length !== Object.keys(original.translations).length) return true
  return locales.some(
    (locale) => (draft.translations[locale] ?? '') !== (original.translations[locale] ?? ''),
  )
}

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

function ProposalLocaleRow({
  stringId,
  locale,
  value,
  view,
  disabled,
  onChange,
  bestMatch,
  selected,
  sourceKey,
  onToggleMemory,
}: {
  stringId: string
  locale: string
  value: string
  view: QaView
  disabled: boolean
  onChange: (value: string) => void
  bestMatch?: TranslationMemoryMatch
  selected: boolean
  sourceKey: string
  onToggleMemory: (checked: boolean) => void
}) {
  const inputId = `proposal-${stringId}-${locale}`
  const issuesId = `qa-${stringId}-${locale}`
  return (
    <div
      data-qa-status={view.status}
      className={cn('flex flex-col gap-2 px-4 py-3 transition-colors', selected && 'bg-public')}
    >
      <div className="flex items-start gap-3">
        <label
          htmlFor={inputId}
          className="w-10 shrink-0 pt-1.5 font-mono text-xs font-semibold uppercase text-muted-foreground"
        >
          {locale}
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Textarea
            id={inputId}
            className="field-sizing-content min-h-8 w-full resize-none px-2.5 py-1.5 text-sm leading-relaxed"
            value={value}
            rows={1}
            disabled={disabled}
            autoComplete="off"
            spellCheck
            aria-label={locale}
            placeholder="Translation…"
            aria-describedby={describedByFor(view, issuesId)}
            onChange={(event) => onChange(event.target.value)}
          />
          {bestMatch ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-muted-foreground">
                <MatchBar match={bestMatch} />
                <span aria-hidden="true">·</span>
                <span className="truncate text-foreground/80">{bestMatch.translation}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled}
                aria-pressed={selected}
                aria-label={`Use match for ${locale} in ${sourceKey}`}
                onClick={() => onToggleMemory(!selected)}
              >
                {selected ? 'Using match' : 'Use match'}
              </Button>
            </div>
          ) : null}
        </div>
        {!selected ? (
          <QaLocaleBadge
            view={view}
            locale={locale}
            footer={QA_APPLY_FOOTER}
            id={issuesId}
            showClean={false}
          />
        ) : null}
      </div>
    </div>
  )
}

function ProposalTreeNode({
  item,
  disabled,
  qa,
  onChange,
  sourceConflict,
  onRemove,
  onToggleMemory,
}: {
  item: TranslateProposalItem
  disabled: boolean
  qa: Record<string, QaView>
  onChange: (stringId: string, locale: string, value: string) => void
  sourceConflict?: TranslationSourceConflict
  onRemove: () => void
  onToggleMemory: (stringId: string, locale: string, checked: boolean) => void
}) {
  const locales = Object.entries(item.translations)
  const moduleLabel = item.module_name ?? item.module_slug

  return (
    <li
      id={`proposal-${item.string_id}`}
      className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs"
    >
      <div className="flex flex-col gap-1 border-b border-border/60 bg-muted/25 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs font-medium break-all text-foreground/90" translate="no">
            {item.key}
          </code>
          {moduleLabel ? (
            <Badge variant="outline" className="font-mono text-[11px] font-normal text-muted-foreground">
              {moduleLabel}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap wrap-anywhere text-foreground">
          {item.source_text}
        </p>
        {item.description ? (
          <p className="text-xs whitespace-pre-wrap text-muted-foreground">{item.description}</p>
        ) : null}
        {sourceConflict ? (
          <Alert variant="destructive" className="mt-2">
            <AlertTitle>Source text changed since generation</AlertTitle>
            <AlertDescription>
              <p className="whitespace-pre-wrap">Reviewed source: {sourceConflict.expected_source_text}</p>
              <p className="whitespace-pre-wrap">Latest saved source: {sourceConflict.source_text}</p>
              <p>Nothing was saved. Regenerate changed strings before saving again.</p>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRemove}>
                Remove from review
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div
        className="divide-y divide-border/50"
        role="group"
        aria-label={`Translations for ${item.key}`}
      >
        {item.memory_error ? (
          <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
            Could not load published translations.
          </p>
        ) : null}
        {locales.map(([locale, value]) => (
          <ProposalLocaleRow
            key={locale}
            stringId={item.string_id}
            locale={locale}
            value={value}
            bestMatch={sourceConflict ? undefined : item.memory?.[locale]?.[0]}
            selected={item.memory_selected?.includes(locale) ?? false}
            sourceKey={item.key}
            onToggleMemory={(checked) => onToggleMemory(item.string_id, locale, checked)}
            view={localeView(qa, item.string_id, locale)}
            disabled={disabled}
            onChange={(next) => onChange(item.string_id, locale, next)}
          />
        ))}
      </div>
    </li>
  )
}

export function TranslateReviewDialog({
  open,
  projectId,
  loadingQueue,
  generating,
  saving = null,
  generated,
  error,
  items,
  page,
  pageSize,
  total,
  onPageChange,
  onClose,
  onTranslate,
  onSaveDraft,
  onReviewPublish,
  publishReview = null,
  reviewing = false,
  reviewLoading = false,
  onBackToEdit,
  onPublish,
  savedNotice,
  refreshError,
  onRetryRefresh,
  progress,
  sourceConflicts = [],
  recoveryMessage,
  onRegenerate,
  onRemoveFromReview,
}: {
  open: boolean
  projectId: string
  loadingQueue: boolean
  generating: boolean
  /** The write in flight, if any. */
  saving?: 'draft' | 'publish' | null
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
  onSaveDraft: (items: TranslateProposalItem[]) => void
  /** Freeze the current page's reviewed rows and show the full public diff. */
  onReviewPublish: (items: TranslateProposalItem[]) => void
  /** Proposed public state of the frozen review; null while loading. */
  publishReview?: StringEntry[] | null
  reviewing?: boolean
  reviewLoading?: boolean
  onBackToEdit?: () => void
  onPublish?: () => void
  savedNotice?: string | null
  refreshError?: string | null
  onRetryRefresh?: () => void
  sourceConflicts?: TranslationSourceConflict[]
  recoveryMessage?: string | null
  onRegenerate?: (items: TranslateProposalItem[]) => void
  onRemoveFromReview?: (items: TranslateProposalItem[], stringId: string) => void
}) {
  const applying = saving !== null
  const [drafts, setDrafts] = useState<Record<string, TranslateProposalItem>>(() =>
    draftsFromItems(items),
  )
  const [memoryUndo, setMemoryUndo] = useState<Record<string, TranslateProposalItem> | null>(null)
  const [cellOriginals, setCellOriginals] = useState<Record<string, TranslateProposalItem>>({})
  // Loaded page. Frozen while generated proposals replace items; a draft echo is not a new load.
  const loadedPage = useRef(items)
  const sawGenerated = useRef(false)

  useEffect(() => {
    setDrafts(draftsFromItems(items))
    setMemoryUndo(null)
    // Generation refreshes items; keep restore values for unchanged selected cells.
    setCellOriginals((prev) =>
      Object.fromEntries(
        items.flatMap((item) =>
          (item.memory_selected ?? []).flatMap((locale) => {
            const id = qaId(item.string_id, locale)
            const original = prev[id]
            return original?.source_text === item.source_text ? [[id, original]] : []
          }),
        ),
      ),
    )
  }, [items])

  const draftList = items.flatMap((item) => {
    const draft = drafts[item.string_id]
    return draft ? [draft] : []
  })
  const echoed =
    items.length === draftList.length &&
    items.every((item) => {
      const draft = drafts[item.string_id]
      return draft !== undefined && !draftDiffers(draft, item)
    })
  if (generated) sawGenerated.current = true
  else if (sawGenerated.current) {
    loadedPage.current = items
    sawGenerated.current = false
  } else if (!echoed) loadedPage.current = items

  const exactCells = draftList.flatMap((item) =>
    Object.keys(item.translations).flatMap((locale) => {
      if (sourceConflicts.some((conflict) => conflict.string_id === item.string_id)) return []
      const match = (item.memory?.[locale] ?? []).find((candidate) => candidate.exact)
      return match ? [{ item, locale, match }] : []
    }),
  )
  const unusedExact = exactCells.filter(
    ({ item, locale }) => !item.memory_selected?.includes(locale),
  )

  function chooseMemory(stringId: string, locale: string, match: TranslationMemoryMatch) {
    setMemoryUndo(null)
    setCellOriginals((prev) => ({
      ...prev,
      [qaId(stringId, locale)]: prev[qaId(stringId, locale)] ?? drafts[stringId],
    }))
    setDrafts((prev) => applyMemoryTranslation(prev, stringId, locale, match))
  }

  function restoreCell(
    current: TranslateProposalItem,
    original: TranslateProposalItem | undefined,
    locale: string,
  ): TranslateProposalItem {
    const next = {
      ...current,
      translations: { ...current.translations, [locale]: original?.translations[locale] ?? '' },
      scores: { ...current.scores },
      issues: { ...current.issues },
      memory_selected: current.memory_selected?.filter((value) => value !== locale),
      memory_choice: Object.fromEntries(
        Object.entries(current.memory_choice ?? {}).filter(([key]) => key !== locale),
      ),
    }
    delete next.scores[locale]
    delete next.issues[locale]
    if (original?.scores?.[locale] !== undefined) next.scores[locale] = original.scores[locale]
    if (original?.issues?.[locale]) next.issues[locale] = original.issues[locale]
    return next
  }

  function toggleMemory(stringId: string, locale: string, checked: boolean) {
    if (checked) {
      const match = drafts[stringId].memory?.[locale]?.[0]
      if (match) chooseMemory(stringId, locale, match)
      return
    }
    setMemoryUndo(null)
    setDrafts((prev) => ({
      ...prev,
      [stringId]: restoreCell(prev[stringId], cellOriginals[qaId(stringId, locale)], locale),
    }))
    setCellOriginals((prev) => {
      const next = { ...prev }
      delete next[qaId(stringId, locale)]
      return next
    })
  }

  function useExactMatches() {
    setMemoryUndo(drafts)
    let next = drafts
    const originals = { ...cellOriginals }
    for (const { item, locale, match } of unusedExact) {
      originals[qaId(item.string_id, locale)] ??= item
      next = applyMemoryTranslation(next, item.string_id, locale, match)
    }
    setCellOriginals(originals)
    setDrafts(next)
  }

  function undoExactMatches() {
    if (!memoryUndo) return
    setDrafts((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, item]) => {
          let next = item
          for (const locale of item.memory_selected ?? []) {
            if (!memoryUndo[id]?.memory_selected?.includes(locale))
              next = restoreCell(next, memoryUndo[id], locale)
          }
          return [id, next]
        }),
      ),
    )
    setCellOriginals((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([id]) => {
          return !draftList.some((item) =>
            (item.memory_selected ?? []).some(
              (locale) =>
                qaId(item.string_id, locale) === id &&
                !memoryUndo[item.string_id]?.memory_selected?.includes(locale),
            ),
          )
        }),
      ),
    )
    setMemoryUndo(null)
  }

  const applyCount = filledCount(draftList)
  const loadedById = new Map(loadedPage.current.map((item) => [item.string_id, item]))
  const pageLocked = draftList.some((draft) => draftDiffers(draft, loadedById.get(draft.string_id)))
  const missingCount = localeCount(draftList) - applyCount
  const busy = loadingQueue || generating || applying || reviewLoading
  const canTranslate =
    !busy &&
    draftList.some((item) =>
      Object.keys(item.translations).some((locale) => !item.memory_selected?.includes(locale)),
    ) &&
    sourceConflicts.length === 0
  const canApply = !busy && applyCount > 0 && sourceConflicts.length === 0
  const canPage = total > pageSize
  const pagingInPlace = loadingQueue && draftList.length > 0
  const showInitialSpinner = loadingQueue && draftList.length === 0
  const generatingLabel = translateProgressLabel(progress)
  const generatingPercent = translateProgressPercent(progress)
  const statusDescription = reviewStatusDescription({
    loadingInitial: showInitialSpinner,
    total,
    pageStringCount: draftList.length,
    missingCount,
    applyCount,
  })
  const publishCount = publishReview?.length ?? 0
  const currentStep = reviewing ? 2 : generated || applyCount > 0 ? 1 : 0
  const description = reviewing
    ? reviewLoading && !publishReview
      ? 'Comparing changes…'
      : `Publish ${publishCount} reviewed ${publishCount === 1 ? 'string' : 'strings'}.`
    : statusDescription
  const qa = useQaWatch(projectId, qaRowsFor(draftList, items), open && !generating)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying && !generating && !reviewing) onClose()
      }}
    >
      <ReviewDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const root = event.currentTarget
          if (!(root instanceof HTMLElement)) return
          const target =
            root.querySelector<HTMLElement>('textarea:not([disabled])') ??
            root.querySelector<HTMLElement>('[data-slot="dialog-close"]')
          target?.focus()
        }}
      >
        <ReviewDialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="truncate">
              {reviewing
                ? 'Review Publication'
                : generated
                  ? 'Review Translations'
                  : 'Missing Translations'}
            </DialogTitle>
            <TranslateStepper current={currentStep} />
          </div>
          <div className="flex min-h-6 items-center justify-between gap-3" aria-live="polite">
            <DialogDescription className="min-w-0 truncate">
              {generating ? generatingLabel : description}
            </DialogDescription>
            {generating ? (
              <Progress
                value={generatingPercent}
                aria-label={generatingLabel}
                aria-valuetext={generatingLabel}
                className={cn('w-28 shrink-0', generatingPercent == null && 'animate-pulse')}
              />
            ) : !reviewing && (unusedExact.length > 0 || memoryUndo) ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {unusedExact.length > 0 ? (
                  <Button type="button" variant="outline" size="xs" disabled={busy} onClick={useExactMatches}>
                    <CheckCheck data-icon="inline-start" />
                    {`Use ${unusedExact.length} exact ${unusedExact.length === 1 ? 'match' : 'matches'}`}
                  </Button>
                ) : null}
                {memoryUndo ? (
                  <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={undoExactMatches}>
                    Undo
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {savedNotice && !reviewing ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
              <Check className="size-4 text-primary" aria-hidden="true" />
              {savedNotice}
            </p>
          ) : null}
          {refreshError ? (
            <Alert>
              <AlertTitle>Saved, but the list could not refresh</AlertTitle>
              <AlertDescription>
                <p>{refreshError}</p>
                <Button type="button" variant="outline" size="sm" disabled={loadingQueue} onClick={onRetryRefresh}>
                  {loadingQueue ? <Spinner data-icon="inline-start" /> : null}
                  Retry loading
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {!reviewing && error && !loadingQueue && !refreshError ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
          {recoveryMessage ? (
            <p className="text-sm text-destructive" role="status">
              {recoveryMessage}
            </p>
          ) : null}
        </ReviewDialogHeader>

        <ReviewDialogBody>
          {reviewing ? (
            <TranslatePublishReview entries={publishReview} loading={reviewLoading} />
          ) : showInitialSpinner ? (
            <div
              className="flex h-52 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <Spinner />
              Loading missing strings…
            </div>
          ) : refreshError && draftList.length === 0 ? (
            <EmptyState
              title="List not refreshed"
              description="Your changes were saved. Retry loading to continue reviewing."
            />
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
              <ul
                className={cn(
                  'flex min-w-0 flex-col gap-3 overflow-x-clip',
                  pagingInPlace && 'pointer-events-none opacity-60',
                )}
              >
                {draftList.map((item) => (
                  <ProposalTreeNode
                    key={item.string_id}
                    item={item}
                    qa={qa}
                    sourceConflict={sourceConflicts.find(
                      (conflict) => conflict.string_id === item.string_id,
                    )}
                    onRemove={() => onRemoveFromReview?.(draftList, item.string_id)}
                    onToggleMemory={toggleMemory}
                    disabled={applying || generating || pagingInPlace}
                    onChange={(stringId, locale, value) => {
                      setMemoryUndo(null)
                      if (!drafts[stringId].memory_selected?.includes(locale) || !value.trim()) {
                        setCellOriginals((prev) => {
                          const next = { ...prev }
                          delete next[qaId(stringId, locale)]
                          return next
                        })
                      }
                      setDrafts((prev) => updateDraftTranslation(prev, stringId, locale, value))
                    }}
                  />
                ))}
              </ul>
            </div>
          )}
        </ReviewDialogBody>

        {canPage && !reviewing ? (
          <div className="shrink-0 border-t px-5">
            <DataPagination
              page={page}
              pageSize={pageSize}
              total={total}
              disabled={busy}
              blockedReason={pageLocked ? PAGE_BLOCKED : undefined}
              onPageChange={onPageChange}
            />
          </div>
        ) : null}

        <ReviewDialogFooter>
          {reviewing ? (
            <>
              <Button variant="outline" type="button" onClick={onBackToEdit} disabled={applying}>
                <ArrowLeft data-icon="inline-start" />
                Back to edit
              </Button>
              <Button
                type="button"
                disabled={applying || reviewLoading || publishCount === 0}
                onClick={onPublish}
              >
                {saving === 'publish' ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                {`Publish ${publishCount === 1 ? '1 string' : `${publishCount} strings`}`}
              </Button>
            </>
          ) : (
            <>
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
                  {generating ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Wand2 data-icon="inline-start" />
                  )}
                  Regenerate changed strings
                </Button>
              ) : null}
              <Button
                variant={applyCount > 0 ? 'outline' : 'default'}
                type="button"
                disabled={!canTranslate}
                onClick={() => onTranslate(draftList)}
              >
                {generating ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Wand2 data-icon="inline-start" />
                )}
                {generated ? 'Translate again' : 'Translate'}
              </Button>
              {applyCount > 0 ? (
                <>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={!canApply}
                    onClick={() => onSaveDraft(draftList)}
                  >
                    {saving === 'draft' ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Save data-icon="inline-start" />
                    )}
                    Save as draft
                  </Button>
                  <Button
                    type="button"
                    disabled={!canApply}
                    onClick={() => onReviewPublish(draftList)}
                  >
                    {reviewLoading ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Check data-icon="inline-start" />
                    )}
                    Review & publish
                  </Button>
                </>
              ) : null}
            </>
          )}
        </ReviewDialogFooter>
      </ReviewDialogContent>
    </Dialog>
  )
}
