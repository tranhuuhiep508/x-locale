import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { useCallback, useEffect, useState } from 'react'
import { Check, Wand2 } from 'lucide-react'
import type { Job, TranslateJobProgress, TranslateProposalItem, TranslationMemorySuggestion, TranslationSourceConflict } from '@/lib/api/types'
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
import { ConfidenceBadge } from '@/features/strings/confidence'
import { TranslationQA } from '@/features/strings/TranslationQA'
import { qaSnapshot, useTranslationQA } from '@/features/strings/use-translation-qa'
import {
  type DescriptionConflict,
  draftsFromItems,
  acceptMemorySuggestion,
  filledCount,
  localeCount,
  reviewStatusDescription,
  translateProgressLabel,
  translateProgressPercent,
  updateDraftDescription,
  updateDraftTranslation,
} from '@/features/strings/translate-review'
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

function ProposalTreeNode({
  projectId,
  onQA,
  item,
  review,
  disabled,
  onChange,
  onAcceptMemory,
  onDescriptionChange,
  conflict,
  onResolveConflict,
  sourceConflict,
  onRemove,
}: {
  projectId: string
  onQA: (id: string, summary: QASummary) => void
  item: TranslateProposalItem
  review: boolean
  disabled: boolean
  onAcceptMemory: (stringId: string, locale: string, suggestion: TranslationMemorySuggestion) => void
  onChange: (stringId: string, locale: string, value: string) => void
  onDescriptionChange: (stringId: string, description: string) => void
  conflict?: DescriptionConflict
  onResolveConflict: (conflict: DescriptionConflict, useLatest: boolean) => void
  sourceConflict?: TranslationSourceConflict
  onRemove: () => void
}) {
  const locales = Object.entries(item.translations)
  const validation = useTranslationQA(projectId, item.source_text, item.translations, {
    source: item.source_text, translations: item.translations, qa: item.qa,
  }, review && !disabled)
  const results = Object.values(validation.qa)
  const errors = results.flatMap((result) => result.issues).filter((issue) => issue.severity === 'error').length
  const warnings = results.flatMap((result) => result.issues).filter((issue) => issue.severity === 'warning').length
  const affected = results.filter((result) => result.issues.length > 0 || !result.complete).length
  const snapshot = qaSnapshot(item.source_text, item.translations)
  const memorySafe = (item.memory_locales ?? []).every((locale) => {
    const result = validation.qa[locale]
    return validation.status === 'checked' && result?.complete && !result.issues.some((issue) => issue.severity === 'error')
  })
  useEffect(() => {
    onQA(item.string_id, { snapshot, errors, warnings, affected, memorySafe })
  }, [onQA, item.string_id, snapshot, errors, warnings, affected, memorySafe])
  const descriptionId = `proposal-description-${item.string_id}`

  return (
    <li
      className={cn(
        'grid min-w-0 gap-4 rounded-xl border border-border/80 bg-card p-4.5 shadow-2xs transition-all',
        review && 'sm:grid-cols-2'
      )}
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Source text</span>
            {item.status === 'public' ? (
              <Badge variant="outline" className="font-mono text-[10px] uppercase">Public</Badge>
            ) : null}
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
        {review || Object.keys(item.memory_suggestions ?? {}).length > 0 ? (
          locales.map(([locale, value]) => {
            const inputId = `proposal-${item.string_id}-${locale}`
            return (
              <Field key={locale} className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor={inputId} className="uppercase font-mono text-xs font-semibold">
                    {locale}
                  </FieldLabel>
                  {item.memory_locales?.includes(locale)
                    ? <Badge variant="outline">Previously published</Badge>
                    : <ConfidenceBadge score={item.scores?.[locale]} />}
                </div>
                <Textarea
                  id={inputId}
                  className="min-h-12 resize-none mt-1 text-xs"
                  value={value}
                  rows={2}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck
                  aria-describedby={`${inputId}-qa`}
                  onBlur={validation.flush}
                  onChange={(e) => onChange(item.string_id, locale, e.target.value)}
                />
                <TranslationQA id={`${inputId}-qa`} result={validation.qa[locale]} status={value.trim() ? validation.status : 'unchecked'} />
                {(item.memory_suggestions?.[locale] ?? []).map((suggestion) => (
                  <div key={suggestion.string_id} className="mt-2 space-y-2 rounded-md border p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">Previously published</Badge>
                      <span>{suggestion.match_type === 'exact' ? 'Exact match' : `Fuzzy match · ${Math.round(suggestion.similarity * 100)}% similarity`}</span>
                    </div>
                    <p className="break-all text-muted-foreground">{suggestion.module_slug ?? 'Unassigned'} / {suggestion.key}</p>
                    <p className="whitespace-pre-wrap wrap-anywhere">{suggestion.source_text}</p>
                    <p className="whitespace-pre-wrap wrap-anywhere font-medium">{suggestion.value}</p>
                    <TranslationQA id={`${inputId}-memory-${suggestion.string_id}-qa`} result={suggestion.qa} status="checked" />
                    {!suggestion.can_accept ? <p className="text-destructive">Structural errors or incomplete QA prevent reuse.</p> : null}
                    <Button type="button" variant="outline" size="sm" disabled={disabled || !suggestion.can_accept}
                      onClick={() => onAcceptMemory(item.string_id, locale, suggestion)}>Use translation</Button>
                  </div>
                ))}
              </Field>
            )
          })
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

type QASummary = { snapshot: string; errors: number; warnings: number; affected: number; memorySafe: boolean }

export function TranslateReviewDialog({
  projectId,
  open,
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
  projectId: string
  open: boolean
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
  const [qaSummaries, setQASummaries] = useState<Record<string, QASummary>>({})
  const reportQA = useCallback((id: string, summary: QASummary) => {
    setQASummaries((previous) => ({ ...previous, [id]: summary }))
  }, [])
  const [drafts, setDrafts] = useState<Record<string, TranslateProposalItem>>(() =>
    draftsFromItems(items)
  )

  useEffect(() => {
    setDrafts(draftsFromItems(items))
  }, [items])

  const draftList = items.flatMap((item) => {
    const draft = drafts[item.string_id]
    return draft ? [draft] : []
  })
  const publicCount = draftList.filter((item) => item.status === 'public').length
  const qaTotals = draftList.reduce((totals, item) => {
    const summary = qaSummaries[item.string_id]
    if (summary?.snapshot === qaSnapshot(item.source_text, item.translations)) {
      totals.errors += summary.errors
      totals.warnings += summary.warnings
      totals.affected += summary.affected
    }
    return totals
  }, { errors: 0, warnings: 0, affected: 0 })
  const missingCount = localeCount(draftList)
  const applyCount = filledCount(draftList)
  const review = (generated || applyCount > 0) && !generating
  const busy = loadingQueue || generating || applying
  const canTranslate = !busy && draftList.length > 0 && conflicts.length === 0 && sourceConflicts.length === 0
  const memorySafe = draftList.every((item) => !(item.memory_locales?.length) || (
    qaSummaries[item.string_id]?.snapshot === qaSnapshot(item.source_text, item.translations)
    && qaSummaries[item.string_id]?.memorySafe
  ))
  const canApply = memorySafe && review && !busy && applyCount > 0 && !error && conflicts.length === 0 && sourceConflicts.length === 0
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
          {review ? <p className="text-xs text-muted-foreground" role="status">
            QA: {qaTotals.affected} translations with findings · {qaTotals.errors} structural errors · {qaTotals.warnings} advisory warnings.
            {' '}QA blocks unsafe memory reuse; other QA findings are advisory. Applied translations stay in the working copy until published.
          </p> : null}
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
            <div className="relative" aria-busy={pagingInPlace || generating}>
              {pagingInPlace ? (
                <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/60 pt-16">
                  <Spinner />
                </div>
              ) : null}
              <ul
                className={cn(
                  'flex flex-col gap-3',
                  pagingInPlace && 'pointer-events-none opacity-60'
                )}
              >
                {draftList.map((item) => (
                  <ProposalTreeNode
                    key={item.string_id}
                    projectId={projectId}
                    onQA={reportQA}
                    item={item}
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
                    onAcceptMemory={(stringId, locale, suggestion) =>
                      setDrafts((prev) => acceptMemorySuggestion(prev, stringId, locale, suggestion))
                    }
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
