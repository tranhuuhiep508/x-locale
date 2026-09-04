import { useEffect, useState } from 'react'
import { Check, Wand2 } from 'lucide-react'
import type { Job, TranslateProposalItem } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ConfidenceBadge } from '@/features/strings/confidence'

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

function cloneItems(items: TranslateProposalItem[]): TranslateProposalItem[] {
  return items.map((item) => ({
    ...item,
    description: item.description ?? '',
    translations: { ...item.translations },
    scores: { ...(item.scores ?? {}) },
  }))
}

function filledCount(items: TranslateProposalItem[]): number {
  let count = 0
  for (const item of items) {
    for (const value of Object.values(item.translations)) {
      if (value.trim()) count += 1
    }
  }
  return count
}

function localeCount(items: TranslateProposalItem[]): number {
  let count = 0
  for (const item of items) {
    count += Object.keys(item.translations).length
  }
  return count
}

function updateDraft(
  prev: TranslateProposalItem[],
  stringId: string,
  locale: string,
  value: string,
): TranslateProposalItem[] {
  return prev.map((row) => {
    if (row.string_id !== stringId) return row
    const scores = { ...(row.scores ?? {}) }
    delete scores[locale]
    return { ...row, translations: { ...row.translations, [locale]: value }, scores }
  })
}

function updateDescription(
  prev: TranslateProposalItem[],
  stringId: string,
  description: string,
): TranslateProposalItem[] {
  return prev.map((row) => (row.string_id === stringId ? { ...row, description } : row))
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
  onClose,
  onTranslate,
  onApply,
}: {
  open: boolean
  loadingQueue: boolean
  generating: boolean
  applying: boolean
  generated: boolean
  error: string | null
  items: TranslateProposalItem[]
  onClose: () => void
  onTranslate: (items: TranslateProposalItem[]) => void
  onApply: (items: TranslateProposalItem[]) => void
}) {
  const [drafts, setDrafts] = useState<TranslateProposalItem[]>(() => cloneItems(items))

  useEffect(() => {
    setDrafts(cloneItems(items))
  }, [items])

  const publicCount = drafts.filter((item) => item.status === 'public').length
  const missingCount = localeCount(drafts)
  const applyCount = filledCount(drafts)
  const review = generated && !generating
  const busy = loadingQueue || generating || applying
  const canTranslate = !busy && drafts.length > 0
  const canApply = review && !applying && applyCount > 0 && !error

  let description = 'Empty locales only. Existing text was not changed.'
  if (loadingQueue) {
    description = 'Finding empty locales…'
  } else if (generating) {
    description = 'Generating translations…'
  } else if (review && applyCount > 0) {
    description = `${applyCount} empty ${applyCount === 1 ? 'translation' : 'translations'} across ${drafts.length} ${drafts.length === 1 ? 'string' : 'strings'}. Add description context and Translate again if the draft is off.`
  } else if (!generated && missingCount > 0) {
    description = `${missingCount} empty ${missingCount === 1 ? 'locale' : 'locales'} across ${drafts.length} ${drafts.length === 1 ? 'string' : 'strings'}. Add description context, then Translate.`
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying && !generating) onClose()
      }}
    >
      <DialogContent className="flex max-h-[min(90dvh,840px)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>{review ? 'Review Translations' : 'Missing Translations'}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {error && !loadingQueue ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : publicCount > 0 && !loadingQueue ? (
            <p className="text-sm text-muted-foreground">
              {publicCount} public {publicCount === 1 ? 'string is' : 'strings are'} in this list.
              Applied values stay in the working copy until you publish.
            </p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {loadingQueue ? (
            <div
              className="flex h-52 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <Spinner />
              Loading missing strings…
            </div>
          ) : error && drafts.length === 0 ? (
            <EmptyState title="Translation failed" description={error} />
          ) : drafts.length === 0 ? (
            <EmptyState
              title="Nothing to translate"
              description="Every target locale already has text."
            />
          ) : (
            <ul className="flex flex-col gap-8">
              {drafts.map((item) => (
                <ProposalTreeNode
                  key={item.string_id}
                  item={item}
                  review={review}
                  disabled={applying || generating}
                  onChange={(stringId, locale, value) =>
                    setDrafts((prev) => updateDraft(prev, stringId, locale, value))
                  }
                  onDescriptionChange={(stringId, description) =>
                    setDrafts((prev) => updateDescription(prev, stringId, description))
                  }
                />
              ))}
            </ul>
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
          <Button type="button" disabled={!canTranslate} onClick={() => onTranslate(drafts)}>
            {generating ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
            {review ? 'Translate again' : 'Translate'}
          </Button>
          {review ? (
            <Button type="button" disabled={!canApply} onClick={() => onApply(drafts)}>
              {applying ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
              Apply {applyCount === 1 ? '1 translation' : `${applyCount} translations`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
