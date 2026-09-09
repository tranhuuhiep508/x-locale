import { useEffect, useState } from 'react'
import { Check, Wand2 } from 'lucide-react'
import type { Job, TranslateJobProgress, TranslateProposalItem } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataPagination } from '@/components/ui/data-pagination'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ConfidenceBadge } from '@/features/strings/confidence'
import {
  draftsFromItems,
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
  result: Record<string, unknown> | null | undefined,
): TranslateProposalItem[] {
  if (!result || !Array.isArray(result.items)) return []
  return result.items as TranslateProposalItem[]
}

export function jobStillRunning(job: Job | undefined): boolean {
  if (!job) return true
  return job.status !== 'completed' && job.status !== 'failed'
}

function ProposalTreeNode({
  item,
  review,
  disabled,
  onChange,
  onDescriptionChange,
}: {
  item: TranslateProposalItem
  review: boolean
  disabled: boolean
  onChange: (stringId: string, locale: string, value: string) => void
  onDescriptionChange: (stringId: string, description: string) => void
}) {
  const locales = Object.entries(item.translations)
  const descriptionId = `proposal-description-${item.string_id}`

  return (
    <li className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-pretty font-medium">{item.source_text}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-xs text-muted-foreground" translate="no">
            {item.key}
          </span>
          {item.status === 'public' ? (
            <Badge variant="secondary">Public — apply stays off prod until publish</Badge>
          ) : null}
        </div>
      </div>

      <Field>
        <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
        <Textarea
          id={descriptionId}
          className="min-h-9 resize-none"
          value={item.description ?? ''}
          rows={2}
          disabled={disabled}
          autoComplete="off"
          placeholder="Context for a better translation"
          onChange={(e) => onDescriptionChange(item.string_id, e.target.value)}
        />
      </Field>

      <FieldGroup
        className="ml-1 gap-3 border-l-2 border-border pl-4"
        aria-label={`Translations for ${item.key}`}
      >
        {review
          ? locales.map(([locale, value]) => {
              const inputId = `proposal-${item.string_id}-${locale}`
              return (
                <Field key={locale}>
                  <div className="flex items-center gap-2">
                    <FieldLabel htmlFor={inputId} className="uppercase">
                      {locale}
                    </FieldLabel>
                    <ConfidenceBadge score={item.scores?.[locale]} />
                  </div>
                  <Textarea
                    id={inputId}
                    className="min-h-9 resize-none"
                    value={value}
                    rows={2}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck
                    onChange={(e) => onChange(item.string_id, locale, e.target.value)}
                  />
                </Field>
              )
            })
          : (
              <div className="flex flex-wrap gap-1.5">
                {locales.map(([locale]) => (
                  <Badge key={locale} variant="outline" className="uppercase">
                    {locale}
                  </Badge>
                ))}
              </div>
            )}
      </FieldGroup>
    </li>
  )
}

export function TranslateReviewDialog({
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
}: {
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
}) {
  const [drafts, setDrafts] = useState<Record<string, TranslateProposalItem>>(() =>
    draftsFromItems(items),
  )

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
  const canTranslate = !busy && draftList.length > 0
  const canApply = review && !applying && applyCount > 0 && !error
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
      <DialogContent className="flex max-h-[min(90dvh,840px)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>{generated ? 'Review Translations' : 'Missing Translations'}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
          {canPage ? (
            <DataPagination
              page={page}
              pageSize={pageSize}
              total={total}
              disabled={busy}
              onPageChange={onPageChange}
            />
          ) : null}
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
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
                  'flex flex-col gap-8',
                  pagingInPlace && 'pointer-events-none opacity-60',
                )}
              >
                {draftList.map((item) => (
                  <ProposalTreeNode
                    key={item.string_id}
                    item={item}
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
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-muted/40 px-5 py-3 sm:justify-end">
          <Button
            variant="outline"
            type="button"
            onClick={onClose}
            disabled={applying || generating}
          >
            Discard
          </Button>
          <Button type="button" disabled={!canTranslate} onClick={() => onTranslate(draftList)}>
            {generating ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
            {review ? 'Translate again' : 'Translate'}
          </Button>
          {review ? (
            <Button type="button" disabled={!canApply} onClick={() => onApply(draftList)}>
              {applying ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
              Apply {applyCount === 1 ? '1 translation' : `${applyCount} translations`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
