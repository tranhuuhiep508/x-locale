import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, CheckCheck, ChevronDown, ChevronUp, Equal, History, Save, Send, Wand2 } from 'lucide-react'
import type { Job, StringEntry, TranslateJobProgress, TranslateProposalItem, TranslationSourceConflict, TranslationMemoryMatch } from '@/lib/api/types'
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
import { MemoryCount, MemoryMatch } from '@/features/strings/translation-memory-view'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfidenceBadge } from '@/features/strings/confidence'
import { describedByFor, QA_APPLY_FOOTER, QaCountBadges, QaIssueBadge, QaLocaleBadge } from '@/features/strings/qa-issue-view'
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
  applyMemoryTranslation,
} from '@/features/strings/translate-review'
import { useQaWatch, type QaWatchRow } from '@/features/strings/use-qa-watch'
import { cn } from '@/lib/utils'
import { TranslatePublishReview } from '@/features/strings/TranslatePublishReview'

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
const PAGE_BLOCKED = "Save or undo this page's changes first"

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
  if ((draft.description ?? '') !== (original.description ?? '')) return true
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

function ProposalLocaleRows({
  stringId,
  locale,
  value,
  score,
  view,
  disabled,
  onChange,
  memory,
  selected,
  choiceId,
  sourceKey,
  aiProposal,
  onToggleMemory,
  onUseMemory,
  foldClean,
}: {
  stringId: string
  locale: string
  value: string
  score: number | undefined
  view: QaView
  disabled: boolean
  onChange: (value: string) => void
  memory?: TranslationMemoryMatch[]
  selected: boolean
  choiceId?: string
  sourceKey: string
  aiProposal?: { text: string; score?: number }
  onToggleMemory: (checked: boolean) => void
  onUseMemory: (match: TranslationMemoryMatch) => void
  foldClean: boolean
}) {
  const [compare, setCompare] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputId = `proposal-${stringId}-${locale}`
  const issuesId = `qa-${stringId}-${locale}`
  const best = memory?.[0]
  const extra = Math.min(memory?.length ?? 0, 3) - 1
  const clean = view.status === 'ready' && !view.stale && presentQaIssues(view.issues).length === 0
  const folded = foldClean && clean && !expanded && !selected
  return (
    <>
      <tr data-qa-status={view.status} className={cn(selected && 'bg-public')}>
        <th scope="row" className="w-12 py-2 pr-2 align-top font-mono text-xs font-semibold uppercase text-muted-foreground">
          {locale}
        </th>
        <td className="relative min-w-0 py-2 pr-3 align-top">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {selected ? null : <ConfidenceBadge score={score} />}
            {selected ? null : (
              <QaLocaleBadge view={view} locale={locale} footer={QA_APPLY_FOOTER} id={issuesId} />
            )}
            {selected ? (
              <p className="min-w-0 text-xs whitespace-pre-wrap wrap-anywhere">{value}</p>
            ) : null}
            {selected ? <p className="text-xs text-muted-foreground">Skipped · using match</p> : null}
            {selected ? null : folded ? (
              <button
                type="button"
                className="block w-full truncate text-left text-xs text-muted-foreground"
                onClick={() => setExpanded(true)}
              >
                {value}
              </button>
            ) : (
              <Textarea
                id={inputId}
                className="field-sizing-fixed h-8 min-h-8 w-full min-w-0 max-w-full resize-none border-transparent bg-transparent px-1 py-1 text-xs shadow-none"
                value={value}
                rows={1}
                cols={12}
                disabled={disabled}
                autoComplete="off"
                spellCheck
                aria-label={locale}
                placeholder="Empty · AI on Translate"
                aria-describedby={describedByFor(view, issuesId)}
                onChange={(event) => onChange(event.target.value)}
              />
            )}
          </div>
        </td>
        <td className="min-w-0 overflow-hidden py-2 pr-3 align-top">
          {best ? (
            <MemoryMatch
              locale={locale}
              match={best}
              hideUse
              disabled={disabled}
              used={choiceId === best.string_id}
              onUse={onUseMemory}
              accessory={(
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
                  aria-label={`Compare ${locale} matches for ${sourceKey}`}
                  aria-expanded={compare}
                  onClick={() => setCompare((open) => !open)}
                >
                  {extra > 0 ? (compare ? 'Less' : `+${extra}`) : null}
                  {compare ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />}
                </button>
              )}
            />
          ) : (
            <p className="pt-1 text-xs text-muted-foreground">No match</p>
          )}
        </td>
        <td className="w-32 py-2 align-top text-right whitespace-nowrap">
          {best ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`Use match for ${locale} in ${sourceKey}`}
              onClick={() => onToggleMemory(!selected)}
            >
              {selected ? 'Using' : 'Use match'}
            </Button>
          ) : null}
        </td>
      </tr>
      {compare && memory?.length ? (
        <tr>
          <td colSpan={4} className="pb-3">
            <div className="grid min-w-0 gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Choose what fills this cell</p>
                <p className="text-sm whitespace-pre-wrap wrap-anywhere">{aiProposal?.text || 'Generated when you click Translate'}</p>
                <ConfidenceBadge score={aiProposal?.score} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={disabled || !selected}
                  onClick={() => onToggleMemory(false)}
                >
                  Use AI
                </Button>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-xs font-medium text-muted-foreground">Previously published</p>
                {memory.slice(0, 3).map((match) => (
                  <MemoryMatch
                    key={match.string_id}
                    locale={locale}
                    match={match}
                    disabled={disabled}
                    used={choiceId === match.string_id}
                    onUse={onUseMemory}
                  />
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function ProposalTreeNode({
  item,
  disabled,
  qa,
  onChange,
  onDescriptionChange,
  conflict,
  onResolveConflict,
  sourceConflict,
  onRemove,
  onUseMemory,
  onToggleMemory,
  cellOriginals,
  foldClean,
}: {
  cellOriginals: Record<string, TranslateProposalItem>
  item: TranslateProposalItem
  disabled: boolean
  qa: Record<string, QaView>
  onChange: (stringId: string, locale: string, value: string) => void
  onDescriptionChange: (stringId: string, description: string) => void
  conflict?: DescriptionConflict
  onResolveConflict: (conflict: DescriptionConflict, useLatest: boolean) => void
  sourceConflict?: TranslationSourceConflict
  onRemove: () => void
  onUseMemory: (stringId: string, locale: string, match: TranslationMemoryMatch) => void
  onToggleMemory: (stringId: string, locale: string, checked: boolean) => void
  foldClean: boolean
}) {
  const locales = Object.entries(item.translations)
  const descriptionId = `proposal-description-${item.string_id}`
  const rollupIssues = locales.flatMap(([locale]) =>
    presentQaIssues(localeView(qa, item.string_id, locale).issues).map((issue) => ({
      ...issue,
      locale,
    })),
  )
  const rollupStale = locales.some(([locale]) => localeView(qa, item.string_id, locale).stale)

  return (
    <li
      id={`proposal-${item.string_id}`}
      className="grid min-w-0 gap-4 rounded-xl border border-border/80 bg-card p-4.5 shadow-2xs transition-all "
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Source text</span>
              <span className="flex items-center gap-1.5">
                <QaIssueBadge
                  label={item.key}
                  issues={rollupIssues}
                  footer={QA_APPLY_FOOTER}
                  showClean={false}
                  stale={rollupStale}
                />
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
          <Field className="w-full sm:w-72 sm:shrink-0">
            <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
            <Textarea
              id={descriptionId}
              className="min-h-16 resize-y text-xs"
              value={item.description ?? ''}
              rows={2}
              disabled={disabled}
              autoComplete="off"
              placeholder="Context for a better translation"
              onChange={(e) => onDescriptionChange(item.string_id, e.target.value)}
            />
          </Field>
        </div>
        {sourceConflict ? (
          <Alert variant="destructive">
            <AlertTitle>Source text changed since generation</AlertTitle>
            <AlertDescription>
              <p className="whitespace-pre-wrap">Reviewed source: {sourceConflict.expected_source_text}</p>
              <p className="whitespace-pre-wrap">Latest saved source: {sourceConflict.source_text}</p>
              <p>Nothing was saved. Regenerate changed strings before saving again.</p>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRemove}>Remove from review</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {conflict ? (
          <Alert variant="destructive">
            <AlertTitle>Description changed since review opened</AlertTitle>
            <AlertDescription>
              <p>Latest saved description: {conflict.description ?? '(empty)'}</p>
              <p>Your draft is shown above. Choose which description to use, then save again.</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onResolveConflict(conflict, true)}>Use latest</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onResolveConflict(conflict, false)}>Keep mine</Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <FieldGroup
        className="min-w-0 gap-3 border-t pt-4"
        role="group"
        aria-label={`Translations for ${item.key}`}
      >
        {item.memory_error ? <p role="status" className="text-xs text-muted-foreground">Could not load published translations.</p> : null}
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-12" />
            <col />
            <col />
            <col className="w-32" />
          </colgroup>
          <thead>
            <tr className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <th className="py-1 pr-2 font-medium">Loc</th>
              <th className="py-1 pr-3 font-medium">AI proposal</th>
              <th className="py-1 pr-3 font-medium">Best published match</th>
              <th className="w-32 py-1 font-medium"><span className="sr-only">Use</span></th>
            </tr>
          </thead>
          <tbody>
            {locales.map(([locale, value]) => (
              <ProposalLocaleRows
                key={locale}
                stringId={item.string_id}
                locale={locale}
                value={value}
                score={item.scores?.[locale]}
                memory={sourceConflict ? [] : item.memory?.[locale]}
                selected={item.memory_selected?.includes(locale) ?? false}
                choiceId={item.memory_choice?.[locale]}
                sourceKey={item.key}
                aiProposal={{ text: cellOriginals[qaId(item.string_id, locale)]?.translations[locale] ?? (item.memory_selected?.includes(locale) ? '' : value), score: (cellOriginals[qaId(item.string_id, locale)] ?? item).scores?.[locale] }}
                onToggleMemory={(checked) => onToggleMemory(item.string_id, locale, checked)}
                onUseMemory={(match) => onUseMemory(item.string_id, locale, match)}
                view={localeView(qa, item.string_id, locale)}
                disabled={disabled}
                foldClean={foldClean}
                onChange={(next) => onChange(item.string_id, locale, next)}
              />
            ))}
          </tbody>
        </table>
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
  onViewInStrings,
  refreshError,
  onRetryRefresh,
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
  onViewInStrings?: () => void
  refreshError?: string | null
  onRetryRefresh?: () => void
  conflicts?: DescriptionConflict[]
  onResolveConflict?: (conflict: DescriptionConflict) => void
  sourceConflicts?: TranslationSourceConflict[]
  recoveryMessage?: string | null
  onRegenerate?: (items: TranslateProposalItem[]) => void
  onRemoveFromReview?: (items: TranslateProposalItem[], stringId: string) => void
}) {
  const applying = saving !== null
  const [drafts, setDrafts] = useState<Record<string, TranslateProposalItem>>(() =>
    draftsFromItems(items)
  )
  const [memoryUndo, setMemoryUndo] = useState<Record<string, TranslateProposalItem> | null>(null)
  const [cellOriginals, setCellOriginals] = useState<Record<string, TranslateProposalItem>>({})
  const [filter, setFilter] = useState<QaFilter | 'matches' | 'exact'>('all')
  // Loaded page. Frozen while generated proposals replace items; a draft echo is not a new load.
  const loadedPage = useRef(items)
  const sawGenerated = useRef(false)

  useEffect(() => {
    setFilter('all')
  }, [page])

  useEffect(() => {
    setDrafts(draftsFromItems(items))
    setMemoryUndo(null)
    // Generation refreshes items; keep restore values for unchanged selected cells.
    setCellOriginals((prev) => Object.fromEntries(items.flatMap((item) =>
      (item.memory_selected ?? []).flatMap((locale) => {
        const id = qaId(item.string_id, locale)
        const original = prev[id]
        return original?.source_text === item.source_text ? [[id, original]] : []
      }),
    )))
  }, [items])

  const draftList = items.flatMap((item) => {
    const draft = drafts[item.string_id]
    return draft ? [draft] : []
  })
  const echoed = items.length === draftList.length && items.every((item) => {
    const draft = drafts[item.string_id]
    return draft !== undefined && !draftDiffers(draft, item)
  })
  if (generated) sawGenerated.current = true
  else if (sawGenerated.current) {
    loadedPage.current = items
    sawGenerated.current = false
  } else if (!echoed) loadedPage.current = items
  const memoryCells = draftList.flatMap((item) =>
    Object.keys(item.translations).flatMap((locale) => {
      if (sourceConflicts.some((conflict) => conflict.string_id === item.string_id)) return []
      const matches = item.memory?.[locale] ?? []
      return matches.length ? [{ item, locale, matches }] : []
    }),
  )
  const exactCells = memoryCells.filter(({ matches }) => matches.some((match) => match.exact))
  const matchStringCount = new Set(memoryCells.map((cell) => cell.item.string_id)).size
  const exactStringCount = new Set(exactCells.map((cell) => cell.item.string_id)).size
  const unusedExact = exactCells.filter(({ item, locale }) => !item.memory_selected?.includes(locale))
  const usedCount = draftList.reduce((count, item) => count + (item.memory_selected?.length ?? 0), 0)
  const aiCount = localeCount(draftList) - usedCount
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
      memory_choice: Object.fromEntries(Object.entries(current.memory_choice ?? {}).filter(([key]) => key !== locale)),
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
    for (const { item, locale, matches } of unusedExact) {
      originals[qaId(item.string_id, locale)] ??= item
      next = applyMemoryTranslation(
        next,
        item.string_id,
        locale,
        matches.find((match) => match.exact)!,
      )
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

  const publicCount = draftList.filter((item) => item.status === 'public').length
  const applyCount = filledCount(draftList)
  const loadedById = new Map(loadedPage.current.map((item) => [item.string_id, item]))
  const pageLocked = draftList.some((draft) => draftDiffers(draft, loadedById.get(draft.string_id)))
  const missingCount = localeCount(draftList) - applyCount
  const review = !generating
  const busy = loadingQueue || generating || applying || reviewLoading
  const canTranslate = !busy && draftList.some((item) => Object.keys(item.translations).some((locale) => !item.memory_selected?.includes(locale))) && conflicts.length === 0 && sourceConflicts.length === 0
  const canApply = !busy && applyCount > 0 && conflicts.length === 0 && sourceConflicts.length === 0
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
    generated,
  })
  const publishCount = publishReview?.length ?? 0
  const description = reviewing
    ? reviewLoading && !publishReview
      ? 'Comparing the reviewed working copy to public…'
      : `Publish ${publishCount} reviewed ${publishCount === 1 ? 'string' : 'strings'}. Nothing is saved until you publish.`
    : statusDescription
  const qa = useQaWatch(projectId, qaRowsFor(draftList, items), open && !generating)
  const foldClean = shouldFoldCleanLocales(draftList.length)
  const pageViews = filledViews(draftList, qa)
  const pageCounts = tally(pageViews)
  const checking = pageViews.some((view) => view.status === 'checking')
  const pageClean = pageViews.length > 0 && pageViews.every((view) => view.status === 'ready' && !view.stale)
    && pageCounts.errors === 0 && pageCounts.warnings === 0
  const withIssues = draftList.filter((item) => {
    const counts = tally(stringViews(item, qa))
    return counts.errors + counts.warnings > 0
  })
  const withErrors = draftList.filter((item) => tally(stringViews(item, qa)).errors > 0)
  const visible = filter === 'errors' ? withErrors : filter === 'issues' ? withIssues : filter === 'matches' ? draftList.filter((item) => memoryCells.some((cell) => cell.item.string_id === item.string_id)) : filter === 'exact' ? draftList.filter((item) => exactCells.some((cell) => cell.item.string_id === item.string_id)) : draftList
  const seenMatchCount = useRef(matchStringCount)
  const seenExactCount = useRef(exactStringCount)
  useEffect(() => {
    // Opening Exact/Matches on a page that already has none keeps the empty state.
    // A count that drops to zero while that filter is on falls back, same as issues.
    const matchesFellEmpty = filter === 'matches' && matchStringCount === 0 && seenMatchCount.current > 0
    const exactFellEmpty = filter === 'exact' && exactStringCount === 0 && seenExactCount.current > 0
    if (
      (filter === 'errors' && withErrors.length === 0) ||
      (filter === 'issues' && withIssues.length === 0) ||
      matchesFellEmpty ||
      exactFellEmpty
    ) {
      setFilter('all')
    }
    seenMatchCount.current = matchStringCount
    seenExactCount.current = exactStringCount
  }, [filter, withErrors.length, withIssues.length, matchStringCount, exactStringCount])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying && !generating && !reviewing) onClose()
      }}
    >
      <ReviewDialogContent
        className="sm:max-w-4xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const root = event.currentTarget
          if (!(root instanceof HTMLElement)) return
          const filter = root.querySelector<HTMLElement>('[aria-label="Filter translations"] [role="radio"]:not([disabled])')
          const close = root.querySelector<HTMLElement>('[data-slot="dialog-close"]')
          ;(filter ?? close)?.focus()
        }}
      >
        <ReviewDialogHeader>
          <DialogTitle>{reviewing ? 'Review Publication' : generated ? 'Review Translations' : 'Missing Translations'}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {savedNotice && !reviewing ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
              <Check className="size-4 text-primary" aria-hidden="true" />
              {savedNotice}
              {onViewInStrings ? (
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onViewInStrings}>View in Strings</Button>
              ) : null}
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
          {review && !reviewing && draftList.length > 0 ? (
            <div className="flex flex-col gap-2 pt-1">
              {memoryCells.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <History className="size-3.5 shrink-0" aria-hidden="true" />
                  No previously published matches on this page. Translate fills all {localeCount(draftList)} cells with AI.
                </p>
              ) : (
                <TooltipProvider delayDuration={200}>
                  <div className="flex flex-wrap items-center gap-3">
                    <MemoryCount icon={History} label={`Previously published: ${memoryCells.length} of ${localeCount(draftList)} cells have a match`}>{memoryCells.length}/{localeCount(draftList)}</MemoryCount>
                    <MemoryCount icon={Equal} label={`${exactCells.length} cells have an exact match`}>{exactCells.length}</MemoryCount>
                    {usedCount > 0 ? <MemoryCount icon={Check} label={`${usedCount} cells use a match`}>{usedCount}</MemoryCount> : null}
                    {unusedExact.length > 0 ? (
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={useExactMatches}>
                        <CheckCheck data-icon="inline-start" />
                        {canPage
                          ? `Use ${unusedExact.length} exact matches on this page`
                          : `Use ${unusedExact.length} exact matches`}
                      </Button>
                    ) : null}
                    {memoryUndo ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={undoExactMatches}>Undo</Button> : null}
                  </div>
                </TooltipProvider>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {generated ? <>
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
                </> : null}
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {canPage ? (
                    <span id="missing-filter-scope" className="text-xs text-muted-foreground">
                      on this page
                    </span>
                  ) : null}
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={filter}
                  onValueChange={(value) => {
                    if (value === 'all' || value === 'issues' || value === 'errors' || value === 'matches' || value === 'exact') setFilter(value)
                  }}
                  aria-label="Filter translations"
                  aria-describedby={canPage ? 'missing-filter-scope' : undefined}
                >
                  <ToggleGroupItem value="all">All {draftList.length}</ToggleGroupItem>
                  <ToggleGroupItem value="matches">With matches {matchStringCount}</ToggleGroupItem>
                  <ToggleGroupItem value="exact">Exact {exactStringCount}</ToggleGroupItem>
                  {generated ? <>
                  <ToggleGroupItem value="issues" disabled={withIssues.length === 0}>
                    With issues {withIssues.length}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="errors" disabled={withErrors.length === 0}>
                    Errors {withErrors.length}
                  </ToggleGroupItem>
                  </> : null}
                </ToggleGroup>
                </div>
              </div>
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
          {reviewing ? null : error && !loadingQueue && !refreshError ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : publicCount > 0 && !loadingQueue ? (
            <p className="text-sm text-muted-foreground">
              {publicCount} public {publicCount === 1 ? 'string is' : 'strings are'} in this list.
              Save as draft keeps their public text unchanged until you publish.
            </p>
          ) : null}
          {recoveryMessage ? <p className="text-sm text-destructive" role="status">{recoveryMessage}</p> : null}
        </ReviewDialogHeader>

        <ReviewDialogBody>
          {reviewing ? (
            <TranslatePublishReview entries={publishReview} loading={reviewLoading} paged={canPage} />
          ) : showInitialSpinner ? (
            <div
              className="flex h-52 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <Spinner />
              Loading missing strings…
            </div>
          ) : refreshError && draftList.length === 0 ? (
            <EmptyState title="List not refreshed" description="Your changes were saved. Retry loading to continue reviewing." />
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
              {shouldShowQaIndex(draftList.length, filter === 'matches' || filter === 'exact' ? 'all' : filter) ? (
                <QaIndex items={visible} qa={qa} />
              ) : null}
              {visible.length === 0 && (filter === 'exact' || filter === 'matches') ? (
                <EmptyState
                  title={filter === 'exact' ? 'No exact matches on this page' : 'No matches on this page'}
                />
              ) : (
              <ul
                className={cn(
                  'flex min-w-0 flex-col gap-3 overflow-x-clip',
                  pagingInPlace && 'pointer-events-none opacity-60'
                )}
              >
                {visible.map((item) => (
                  <ProposalTreeNode
                    key={item.string_id}
                    item={item}
                    cellOriginals={cellOriginals}
                    qa={qa}
                    conflict={conflicts.find((conflict) => conflict.string_id === item.string_id)}
                    sourceConflict={sourceConflicts.find((conflict) => conflict.string_id === item.string_id)}
                    onRemove={() => onRemoveFromReview?.(draftList, item.string_id)}
                    onResolveConflict={(conflict, useLatest) => {
                      if (useLatest) {
                        setDrafts((prev) => updateDraftDescription(prev, conflict.string_id, conflict.description ?? ''))
                      }
                      onResolveConflict?.(conflict)
                    }}
                    onUseMemory={chooseMemory}
                    onToggleMemory={toggleMemory}
                    foldClean={foldClean}
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
                    onDescriptionChange={(stringId, nextDescription) =>
                      setDrafts((prev) => updateDraftDescription(prev, stringId, nextDescription))
                    }
                  />
                ))}
              </ul>
              )}
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
              note={filter === 'all' ? undefined : `Showing ${visible.length} of ${draftList.length} on this page`}
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
              <Button type="button" disabled={applying || reviewLoading || publishCount === 0} onClick={onPublish}>
                {saving === 'publish' ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
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
                {generated ? `Translate again · ${aiCount} cells` : `Translate ${aiCount} cells`}
              </Button>
              {applyCount > 0 ? (
                <>
                  <Button variant="outline" type="button" disabled={!canApply} onClick={() => onSaveDraft(draftList)}>
                    {saving === 'draft' ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                    {`Save ${applyCount === 1 ? '1 translation' : `${applyCount} translations`} as draft`}
                  </Button>
                  <Button type="button" disabled={!canApply} onClick={() => onReviewPublish(draftList)}>
                    {reviewLoading ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                    {canPage ? 'Review & publish this page' : 'Review & publish'}
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
