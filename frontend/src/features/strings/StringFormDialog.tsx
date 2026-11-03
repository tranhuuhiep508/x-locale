import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Undo2, Wand2 } from 'lucide-react'
import { stringsApi } from '@/lib/api/strings'
import { ApiError } from '@/lib/api/client'
import type {
  EditorProposal,
  EditorPreview,
  EditorSaveRequest,
  BatchRequest,
  Module,
  StringEntry,
  StringUpdate,
  Tag,
  TranslationStatus,
  TranslationMemoryMatch,
} from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Spinner } from '@/components/ui/spinner'
import { CreateModulePopover, CreateTagPopover } from '@/features/strings/CatalogCreatePopovers'
import { TranslationMemoryPanel } from '@/features/strings/translation-memory-view'
import { useTranslationMemory } from '@/features/strings/use-translation-memory'
import { ConfidenceBadge, dropScore, mergeScores } from '@/features/strings/confidence'
import type { QaBaseline } from '@/features/strings/qa-issues'
import { describedByFor, QA_SAVE_FOOTER, QaLocaleBadge } from '@/features/strings/qa-issue-view'
import { useQaWatch, type QaWatchRow } from '@/features/strings/use-qa-watch'
import { PublishedChangeHint, canDiscardWorkingCopy, isReleased } from '@/features/strings/working-copy'
import { StringHistoryPanel } from '@/features/strings/StringHistoryPanel'
import { EditorPublicationReview } from './EditorPublicationReview'
import { buildPublishPreview, hasPublishableChanges, isPublishFingerprintMismatch, publicationErrorMessage } from './publish-preview'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface Props {
  projectId: string
  entry?: StringEntry | null
  modules: Module[]
  tags: Tag[]
  targetLocales: string[]
  initialTab?: 'details' | 'history'
  onClose: () => void
  onSuccess: () => void
  onViewInStrings?: (entry: StringEntry) => void
}

const NONE_MODULE = '__none__'
const NONE_TAG = '__none__'

/** Portaled popover/select layers sit outside dialog content in the DOM. */
function isNestedOverlayTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    (target.closest('[data-slot="popover-content"]') != null ||
      target.closest('[data-slot="select-content"]') != null)
  )
}

function isFocusOutsideEvent(event: { detail?: { originalEvent?: Event } }) {
  return event.detail?.originalEvent?.type === 'focusin'
}

type FormErrors = Partial<Record<'key' | 'source_text', string>>
type SaveConflict = { fields: string[]; current: StringEntry }

function editorValues(entry: StringEntry) {
  return {
    key: entry.key,
    source_text: entry.source_text,
    description: entry.description,
    module_id: entry.module_id,
    tag_ids: entry.tags.map((tag) => tag.id).sort(),
    status: entry.status,
    translations: Object.fromEntries(entry.translations.map((t) => [t.locale, t.value])),
    translation_scores: Object.fromEntries(entry.translations.map((t) => [t.locale, t.confidence])),
  }
}

function mergeTranslations(
  prev: Record<string, string>,
  incoming: Record<string, string>,
  overwrite: boolean,
): Record<string, string> {
  const next = { ...prev }
  for (const [locale, value] of Object.entries(incoming)) {
    if (!value.trim()) continue
    if (!overwrite && prev[locale]?.trim()) continue
    next[locale] = value
  }
  return next
}

function translationsFromEntry(entry: StringEntry, targetLocales: string[]) {
  const map: Record<string, string> = {}
  for (const locale of targetLocales) {
    map[locale] = entry.translations.find((t) => t.locale === locale)?.value ?? ''
  }
  return map
}

function scoresFromEntry(entry: StringEntry, targetLocales: string[]) {
  const map: Record<string, number> = {}
  for (const locale of targetLocales) {
    const score = entry.translations.find((t) => t.locale === locale)?.confidence
    if (typeof score === 'number') map[locale] = score
  }
  return map
}

function isFormDirty(
  entry: StringEntry,
  targetLocales: string[],
  values: {
    key: string
    sourceText: string
    description: string
    moduleId: string
    tagIds: string[]
    translations: Record<string, string>
    scores: Record<string, number>
  },
): boolean {
  if (values.key !== entry.key) return true
  if (values.sourceText !== entry.source_text) return true
  if (values.description !== (entry.description ?? '')) return true
  if (values.moduleId !== (entry.module_id ?? '')) return true
  if (JSON.stringify([...values.tagIds].sort()) !== JSON.stringify(entry.tags.map((tag) => tag.id).sort())) return true
  const saved = translationsFromEntry(entry, targetLocales)
  const savedScores = scoresFromEntry(entry, targetLocales)
  for (const locale of targetLocales) {
    if ((values.translations[locale] ?? '') !== (saved[locale] ?? '')) return true
    if ((values.scores[locale] ?? null) !== (savedScores[locale] ?? null)) return true
  }
  return false
}

function applyEntryToForm(
  entry: StringEntry,
  targetLocales: string[],
  setters: {
    setKey: (value: string) => void
    setSourceText: (value: string) => void
    setDescription: (value: string) => void
    setModuleId: (value: string) => void
    setTagIds: (value: string[]) => void
    setStatus: (value: TranslationStatus) => void
    setTranslations: (value: Record<string, string>) => void
    setScores: (value: Record<string, number>) => void
  },
) {
  setters.setKey(entry.key)
  setters.setSourceText(entry.source_text)
  setters.setDescription(entry.description ?? '')
  setters.setModuleId(entry.module_id ?? '')
  setters.setTagIds(entry.tags.map((tag) => tag.id))
  setters.setStatus(entry.status)
  setters.setTranslations(translationsFromEntry(entry, targetLocales))
  setters.setScores(scoresFromEntry(entry, targetLocales))
}

export default function StringFormDialog({
  projectId,
  entry,
  modules,
  tags,
  targetLocales,
  initialTab = 'details',
  onClose,
  onSuccess,
  onViewInStrings,
}: Props) {
  const toast = useToast()
  const qc = useQueryClient()
  const [baseline, setBaseline] = useState(entry ?? null)
  const isEdit = Boolean(baseline?.id)
  const [review, setReview] = useState<{ proposal: EditorProposal; preview: EditorPreview } | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const publishButton = useRef<HTMLButtonElement>(null)
  const wasReviewOpen = useRef(false)
  useEffect(() => {
    if (reviewOpen) reviewHeading.current?.focus()
    else if (wasReviewOpen.current) publishButton.current?.focus()
    wasReviewOpen.current = reviewOpen
  }, [reviewOpen])
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const [tab, setTab] = useState<'details' | 'history'>(initialTab)
  const [key, setKey] = useState(entry?.key ?? '')
  const [sourceText, setSourceText] = useState(entry?.source_text ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [moduleId, setModuleId] = useState(entry?.module_id ?? '')
  const [tagIds, setTagIds] = useState(() => entry?.tags.map((tag) => tag.id) ?? [])
  const tagId = tagIds[0] ?? ''
  const setTagId = (value: string) => {
    if (!value) {
      setTagIds([])
      return
    }
    setTagIds([value, ...tagIds.slice(1).filter((id) => id !== value)])
  }
  const [status, setStatus] = useState<TranslationStatus>(() => entry?.status ?? 'draft')
  const [translations, setTranslations] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const locale of targetLocales) {
      const existing = entry?.translations.find((t) => t.locale === locale)
      map[locale] = existing?.value ?? ''
    }
    return map
  })
  const [scores, setScores] = useState<Record<string, number>>(() =>
    entry ? scoresFromEntry(entry, targetLocales) : {},
  )
  const [qaSeeds, setQaSeeds] = useState<Record<string, QaBaseline>>({})
  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [createdModules, setCreatedModules] = useState<Module[]>([])
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const memory = useTranslationMemory(projectId, sourceText, targetLocales, baseline?.id, baseline?.source_text)
  const [memorySelection, setMemorySelection] = useState<{ source: string; chosen: Record<string, string> }>({ source: sourceText, chosen: {} })
  const chosen = memorySelection.source === sourceText ? memorySelection.chosen : {}
  const memoryLocales = Object.keys(chosen)
  const aiLocales = targetLocales.filter((locale) => !memoryLocales.includes(locale))
  const currentSource = useRef(sourceText)
  currentSource.current = sourceText

  function choosePublished(locale: string, match: TranslationMemoryMatch) {
    if (memory.stale) return
    setTranslations((prev) => ({ ...prev, [locale]: match.translation }))
    setScores((prev) => dropScore(prev, locale))
    setQaSeeds((prev) => ({ ...prev, [locale]: { source: sourceText, text: match.translation, issues: match.issues } }))
    setMemorySelection((prev) => ({
      source: sourceText,
      chosen: { ...(prev.source === sourceText ? prev.chosen : {}), [locale]: match.string_id },
    }))
  }

  const [memoryUndo, setMemoryUndo] = useState<null | {
    source: string
    locales: string[]
    translations: Record<string, string>
    scores: Record<string, number>
    seeds: Record<string, QaBaseline>
    selected: typeof memorySelection
  }>(null)
  function useExactMatches() {
    if (memory.stale) return
    const locales = targetLocales.filter(
      (locale) =>
        !memoryLocales.includes(locale) && memory.matches[locale]?.some((match) => match.exact),
    )
    setMemoryUndo({
      source: sourceText,
      locales,
      translations,
      scores,
      seeds: qaSeeds,
      selected: memorySelection,
    })
    for (const locale of locales)
      choosePublished(
        locale,
        memory.matches[locale].find((match) => match.exact)!,
      )
  }
  function undoExactMatches() {
    if (!memoryUndo || memoryUndo.source !== sourceText) return
    for (const locale of memoryUndo.locales) {
      setTranslations((prev) => ({ ...prev, [locale]: memoryUndo.translations[locale] ?? '' }))
      setScores((prev) => {
        const next = dropScore(prev, locale)
        if (memoryUndo.scores[locale] !== undefined) next[locale] = memoryUndo.scores[locale]
        return next
      })
      setQaSeeds((prev) => {
        const next = { ...prev }
        delete next[locale]
        if (memoryUndo.seeds[locale]) next[locale] = memoryUndo.seeds[locale]
        return next
      })
    }
    setMemorySelection(memoryUndo.selected)
    setMemoryUndo(null)
  }

  // Resolving a locale replaces both its text and its associated confidence.
  const conflictFields = [...new Set(conflict?.fields.flatMap((field) => {
    if (field.startsWith('translations.') || field.startsWith('translation_scores.')) {
      const locale = field.split('.')[1]
      return [`translations.${locale}`, `translation_scores.${locale}`]
    }
    return [field]
  }) ?? [])]
  const moduleOptions = [...modules, ...createdModules.filter((item) => !modules.some((m) => m.id === item.id))]
  const tagOptions = [...tags, ...createdTags.filter((item) => !tags.some((t) => t.id === item.id))]
  const selectedTag = tagOptions.find((item) => item.id === tagId)
  const selectedModuleName = moduleOptions.find((item) => item.id === moduleId)?.name

  const formValues = {
    key,
    sourceText,
    description,
    moduleId,
    tagIds,
    translations,
    scores,
  }

  const canAutoTranslate =
    key.trim().length > 0 && sourceText.trim().length > 0 && targetLocales.length > 0

  const payload = () => {
    const body: {
      key: string
      source_text: string
      description: string | null
      module_id: string | null
      tag_ids: string[]
      translations: Record<string, string>
      translation_scores?: Record<string, number>
    } = {
      key: key.trim(),
      source_text: sourceText.trim(),
      description: description.trim() || null,
      module_id: moduleId || null,
      tag_ids: [...tagIds].sort(),
      translations,
    }
    if (Object.keys(scores).length > 0) {
      body.translation_scores = scores
    }
    return body
  }

  function editPayload(): StringUpdate {
    if (!baseline) return {}
    const original = editorValues(baseline)
    const body = payload()
    const edited = { ...body, key, source_text: sourceText, description: description || null }
    const changes: StringUpdate = { expected: {} }
    const expected = changes.expected!
    for (const field of ['key', 'source_text', 'description', 'module_id', 'tag_ids'] as const) {
      const value = body[field]
      if (JSON.stringify(edited[field]) === JSON.stringify(original[field])) continue
      if (value === undefined || JSON.stringify(value) === JSON.stringify(original[field])) continue
      Object.assign(changes, { [field]: value })
      Object.assign(expected, { [field]: original[field] })
    }
    for (const locale of targetLocales) {
      const value = translations[locale] ?? ''
      const saved = original.translations[locale] ?? ''
      const scoreChanged = (scores[locale] ?? null) !== (original.translation_scores[locale] ?? null)
      if (value === saved && !scoreChanged) continue
      changes.translations = { ...changes.translations, [locale]: value }
      expected.translations = { ...expected.translations, [locale]: saved }
      if (scores[locale] !== undefined || scoreChanged) {
        changes.translation_scores = { ...changes.translation_scores, [locale]: scores[locale] ?? null }
        expected.translation_scores = {
          ...expected.translation_scores,
          [locale]: original.translation_scores[locale] ?? null,
        }
      }
    }
    if (changes.translations) expected.source_text = original.source_text
    return changes
  }

  function resolveConflict(useLatest: boolean) {
    if (!conflict || !baseline) return
    // Only rebase reviewed fields. Rebasing the whole form would make untouched,
    // stale inputs look like new edits on the next Save.
    const fresh = conflict.current
    const next = { ...baseline }
    for (const field of conflict.fields) {
      if (field.startsWith('translations.') || field.startsWith('translation_scores.')) {
        const locale = field.split('.')[1]
        const latest = fresh.translations.find((t) => t.locale === locale)
        next.translations = next.translations.filter((t) => t.locale !== locale)
        if (latest) next.translations = [...next.translations, latest]
        if (useLatest) {
          setTranslations((prev) => ({ ...prev, [locale]: latest?.value ?? '' }))
          setMemorySelection((prev) => {
            if (!(locale in prev.chosen)) return prev
            const next = { ...prev.chosen }
            delete next[locale]
            return { ...prev, chosen: next }
          })
          setScores((prev) => {
            const updated = { ...prev }
            delete updated[locale]
            if (latest?.confidence != null) updated[locale] = latest.confidence
            return updated
          })
        }
      } else {
        switch (field) {
          case 'key':
            next.key = fresh.key
            if (useLatest) setKey(fresh.key)
            break
          case 'source_text':
            next.source_text = fresh.source_text
            if (useLatest) setSourceText(fresh.source_text)
            break
          case 'description':
            next.description = fresh.description
            if (useLatest) setDescription(fresh.description ?? '')
            break
          case 'module_id':
            next.module_id = fresh.module_id
            next.module_slug = fresh.module_slug
            if (useLatest) setModuleId(fresh.module_id ?? '')
            break
          case 'tag_ids':
            next.tags = fresh.tags
            if (useLatest) setTagIds(fresh.tags.map((tag) => tag.id))
            break
          case 'status':
            next.status = fresh.status
            if (useLatest) setStatus(fresh.status)
            break
        }
      }
    }
    setMemoryUndo(null)
    setBaseline(next)
    setConflict(null)
  }

  function conflictText(saved: boolean, field: string) {
    const values = saved ? editorValues(conflict!.current) : { ...payload(), status }
    const [name, locale] = field.split('.')
    const value = locale
      ? (values[name as 'translations' | 'translation_scores'] ?? {})[locale]
      : values[name as keyof typeof values]
    return value == null || value === '' ? '(empty)' : Array.isArray(value) ? value.join(', ') || '(none)' : String(value)
  }

  const savedBaselines: Record<string, QaBaseline> = {}
  for (const locale of targetLocales) {
    savedBaselines[locale] = {
      source: baseline?.source_text ?? '',
      text: baseline?.translations.find((item) => item.locale === locale)?.value ?? '',
    }
  }
  const qaRows: QaWatchRow[] = targetLocales.map((locale) => ({
    id: locale,
    locale,
    source: sourceText,
    text: translations[locale] ?? '',
    baseline: qaSeeds[locale] ?? savedBaselines[locale],
  }))
  const qaViews = useQaWatch(projectId, qaRows)

  function proposal(): EditorProposal {
    if (!baseline) return { mode: 'create', values: payload() }
    const changes = editPayload()
    return { mode: 'update', string_id: baseline.id, values: { ...changes, expected: changes.expected! } }
  }

  function refreshQueries() {
    void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
    onSuccess()
  }

  function applySaved(fresh: StringEntry) {
    setBaseline(fresh)
    applyEntryToForm(fresh, targetLocales, {
      setKey, setSourceText, setDescription, setModuleId, setTagIds, setStatus, setTranslations, setScores,
    })
    setConflict(null)
    setMemoryUndo(null)
    setMemorySelection({ source: fresh.source_text, chosen: {} })
    setQaSeeds({})
    setErrors({})
  }

  function editorError(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      const detail = (error.body as { detail?: SaveConflict & { code?: string } })?.detail
      if (detail?.code === 'stale_editor_save') {
        setReviewOpen(false)
        setReview(null)
        setConflict(detail)
        return
      }
    }
    toast.error(publicationErrorMessage(error, 'Failed to save string'))
  }

  const previewMut = useMutation({
    mutationFn: (proposed: EditorProposal) => stringsApi.editorPreview(projectId, proposed),
    onSuccess: (preview, proposed) => {
      setReview({ proposal: proposed, preview })
      setReviewOpen(true)
    },
    onError: (error) => {
      setReviewOpen(false)
      editorError(error)
    },
  })

  const saveMut = useMutation({
    mutationFn: (request: EditorSaveRequest) => stringsApi.editorSave(projectId, request),
    onSuccess: (fresh, request) => {
      applySaved(fresh)
      setReviewOpen(false)
      setReview(null)
      setSaved(true)
      refreshQueries()
      toast.success(request.action === 'publish' ? 'String saved and published' : 'String saved as draft')
    },
    onError: (error, request) => {
      if (isPublishFingerprintMismatch(error)) {
        setReview(null)
        previewMut.mutate(request.proposal)
        toast.info('Working copy changed. Review the updated preview.')
        return
      }
      editorError(error)
    },
  })

  const unpublishMut = useMutation({
    mutationFn: async () => {
      if (!baseline) return null
      await stringsApi.batch(projectId, { action: 'unpublish', string_ids: [baseline.id] })
      return stringsApi.get(projectId, baseline.id)
    },
    onSuccess: (fresh) => {
      if (!fresh) return
      // Keep form inputs and their expected-value baselines; only lifecycle state changed.
      setBaseline((previous) => previous ? { ...previous, status: fresh.status } : fresh)
      setStatus(fresh.status)
      setConfirmUnpublish(false)
      setReview(null)
      refreshQueries()
      toast.success('String unpublished')
    },
    onError: editorError,
  })

  const translateMut = useMutation({
    mutationFn: ({ locales, source }: { locales: string[]; overwrite: boolean; source: string; current: Record<string, string> }) =>
      stringsApi.translatePreview(projectId, {
        source_text: source.trim(),
        description: description.trim() || undefined,
        module_id: moduleId || null,
        locales,
      }),
    onSuccess: (res, { overwrite, source, current }) => {
      if (currentSource.current !== source) return
      setTranslations((prev) => mergeTranslations(prev, res.translations, overwrite))
      setScores((prev) => mergeScores(prev, res.scores, translations, res.translations, overwrite))
      setQaSeeds((prev) => {
        const next = { ...prev }
        for (const [locale, text] of Object.entries(res.translations)) {
          if (!text.trim()) continue
          if (!overwrite && (current[locale] ?? '').trim()) continue
          if (res.issues && locale in res.issues) {
            next[locale] = { source, text, issues: res.issues[locale] }
          }
        }
        return next
      })
      toast.success('Review AI text, then Save')
    },
    onError: () => toast.error('Translation failed — check AI translation credentials'),
  })

  const discardMut = useMutation({
    mutationFn: async () => {
      if (!baseline) return null
      if (canDiscardWorkingCopy(baseline)) {
        await stringsApi.batch(projectId, {
          action: 'discard_changes',
          string_ids: [baseline.id],
        } satisfies BatchRequest)
        return stringsApi.get(projectId, baseline.id)
      }
      return baseline
    },
    onSuccess: (fresh) => {
      if (!fresh) return
      setConfirmDiscard(false)
      setBaseline(fresh)
      setConflict(null)
      applyEntryToForm(fresh, targetLocales, {
        setKey,
        setSourceText,
        setDescription,
        setModuleId,
        setTagIds,
        setStatus,
        setTranslations,
        setScores,
      })
      setMemoryUndo(null)
      setMemorySelection({ source: fresh.source_text, chosen: {} })
      setQaSeeds({})
      setErrors({})
      setReview(null)
      refreshQueries()
      toast.success(serverDiscardable ? 'Working copy discarded' : 'Form changes reset')
    },
    onError: (error) => toast.error(publicationErrorMessage(error, 'Failed to discard changes')),
  })

  function submitAction(action: 'save_draft' | 'publish') {
    if (conflict || busy) return
    const nextErrors: FormErrors = {}
    if (!key.trim()) nextErrors.key = 'Key is required'
    if (!sourceText.trim()) nextErrors.source_text = 'Source text is required'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    if (action === 'publish') previewMut.mutate(proposal())
    else saveMut.mutate({ proposal: proposal(), action })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submitAction('save_draft')
  }

  const busy = saveMut.isPending || previewMut.isPending || translateMut.isPending || discardMut.isPending || unpublishMut.isPending
  const reviewedPreview = review ? buildPublishPreview([review.preview.entry]) : null
  const publicationReady = reviewedPreview != null && hasPublishableChanges(reviewedPreview)
  const released = isEdit && baseline ? isReleased(baseline) : false
  const moduleSlug = moduleOptions.find((item) => item.id === moduleId)?.slug ?? ''
  const serverDiscardable = Boolean(baseline && canDiscardWorkingCopy(baseline))
  const formDirty = Boolean(baseline && isFormDirty(baseline, targetLocales, formValues))
  const canDiscard =
    isEdit && baseline && !baseline.deleted_at && (serverDiscardable || formDirty)

  return (
    <Dialog open onOpenChange={(open) => {
      if (open || busy) return
      if (reviewOpen) { setReviewOpen(false); setReview(null) }
      else onClose()
    }}>
      <DialogContent
        className={cn(
          'flex h-[min(90dvh,760px)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl',
        )}
        onFocusOutside={(event) => {
          // Nested popovers unmount after Create; focus then lands on body, not the
          // popover node. Blocking focus-outside keeps pointer-outside dismiss intact.
          event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isFocusOutsideEvent(event) || isNestedOverlayTarget(event.target)) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-center gap-2">
            <DialogTitle>{isEdit ? 'Edit string' : 'Add string'}</DialogTitle>
            {isEdit && !reviewOpen ? (
              <span
                className={cn(
                  'rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider',
                  status === 'public'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-border/70 bg-muted/50 text-muted-foreground',
                )}
              >
                {status}
              </span>
            ) : null}
            {reviewOpen ? (
              <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary uppercase">
                Publication Review
              </span>
            ) : null}
          </div>
          <DialogDescription>
            {reviewOpen
              ? 'Review proposed changes before promoting to public catalogs.'
              : isEdit
              ? 'Edit the working copy, then save as draft or review publication.'
              : 'Add metadata and translations, then save as draft or review publication.'}
          </DialogDescription>
          {isEdit && !reviewOpen ? (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={tab}
              onValueChange={(value) => {
                if (value === 'details' || value === 'history') setTab(value)
              }}
              className="mt-3 justify-start"
            >
              <ToggleGroupItem value="details">Details</ToggleGroupItem>
              <ToggleGroupItem value="history">History</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </DialogHeader>

        {reviewOpen ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="mb-4 flex flex-col gap-1 border-b border-border/60 pb-3">
                <h2 tabIndex={-1} ref={reviewHeading} className="font-heading text-base font-semibold tracking-tight text-foreground">
                  Review publication
                </h2>
                <p className="text-xs text-muted-foreground">
                  Verify the final snapshot below. Edits are saved and public catalogs update atomically.
                </p>
              </div>
              {review ? <EditorPublicationReview entry={review.preview.entry} /> : <p role="status">Refreshing comparison…</p>}
            </div>
            <DialogFooter className="mx-0 mb-0 shrink-0 flex-col-reverse gap-2 rounded-none border-t bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={busy} onClick={() => {
                setReviewOpen(false)
                setReview(null)
              }}>
                Back to editing
              </Button>
              <Button
                type="button"
                disabled={busy || !publicationReady}
                onClick={() => {
                  if (review) saveMut.mutate({
                    proposal: review.proposal,
                    action: 'publish',
                    fingerprint: review.preview.fingerprint,
                  })
                }}
              >
                {saveMut.isPending && <Spinner data-icon="inline-start" />}
                {review && !publicationReady ? 'Nothing to publish' : 'Publish'}
              </Button>
            </DialogFooter>
          </div>
        ) : isEdit && tab === 'history' && baseline ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <StringHistoryPanel
              projectId={projectId}
              stringId={baseline.id}
              onRestored={async () => {
                const fresh = await stringsApi.get(projectId, baseline!.id)
                setBaseline(fresh)
                setConflict(null)
                applyEntryToForm(fresh, targetLocales, {
                  setKey,
                  setSourceText,
                  setDescription,
                  setModuleId,
                  setTagIds,
                  setStatus,
                  setTranslations,
                  setScores,
                })
                setMemoryUndo(null)
                setMemorySelection({ source: fresh.source_text, chosen: {} })
                setQaSeeds({})
              }}
            />
          </div>
        ) : (
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <fieldset disabled={busy} className="m-0 border-0 p-0 min-w-0">
            {conflict ? (
              <Alert variant="destructive" className="mx-5 mt-5 w-auto">
                <AlertTitle>Another save changed this string</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <p>Your input is still here. Review the conflicting values before saving again. Translation text and confidence are resolved together.</p>
                  {conflictFields.filter((field) => !['deleted_at', 'pending_delete'].includes(field)).map((field) => (
                    <div key={field} className="grid gap-1 whitespace-pre-wrap break-words">
                      <strong>{field.replace('translations.', 'Translation ').replace('translation_scores.', 'Confidence ')}</strong>
                      <span>Your value: {conflictText(false, field)}</span>
                      <span>Latest saved: {conflictText(true, field)}</span>
                    </div>
                  ))}
                  {conflict.current.deleted_at ? (
                    <p>This string was deleted. Close the editor and refresh the catalog.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => resolveConflict(true)}>Use latest values</Button>
                      <Button type="button" variant="outline" onClick={() => resolveConflict(false)}>Keep my changes</Button>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {/* Lifecycle Status Banner */}
            {isEdit && baseline?.deleted_at ? (
              <div className="mx-5 mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive">
                <p className="font-medium">This string is deleted.</p>
                <p className="text-muted-foreground">Restore it from the grid to edit again.</p>
              </div>
            ) : isEdit && baseline?.pending_delete ? (
              <div className="mx-5 mt-5 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                <p>Deletion is pending. Production still has the last published snapshot until you publish the removal.</p>
              </div>
            ) : isEdit && baseline?.status === 'public' ? (
              <div className="mx-5 mt-5 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/40 p-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex size-2 shrink-0">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                  <div className="flex flex-col min-w-0">
                    <p className="text-xs font-semibold text-foreground">
                      Public snapshot is live.
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {baseline.has_unpublished_changes
                        ? 'Production still has the last published snapshot until you publish.'
                        : 'Saving as draft leaves it unchanged.'}
                    </p>
                  </div>
                </div>
                {!baseline.pending_delete && !baseline.deleted_at ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmUnpublish(true)}
                  >
                    Unpublish
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-8 p-5 sm:grid-cols-2">
              <div className="flex flex-col gap-4 sm:border-r sm:border-border/60 sm:pr-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    String details
                  </h3>
                </div>
                <FieldGroup className="gap-4">
                  <Field data-invalid={errors.key ? 'true' : undefined}>
                    <div className="flex items-center gap-1">
                      <FieldLabel htmlFor="string-key" className="text-xs font-medium">Key</FieldLabel>
                      {released && baseline ? (
                        <PublishedChangeHint
                          published={baseline.published_key}
                          working={key}
                          released={released}
                          mono
                        />
                      ) : null}
                    </div>
                    <Input
                      id="string-key"
                      className="font-mono text-xs bg-muted/20 focus-visible:bg-background"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      aria-invalid={errors.key ? true : undefined}
                    />
                    <FieldError>{errors.key}</FieldError>
                  </Field>

                  <Field data-invalid={errors.source_text ? 'true' : undefined}>
                    <div className="flex items-center gap-1">
                      <FieldLabel htmlFor="string-source" className="text-xs font-medium">Source text</FieldLabel>
                      {released && baseline ? (
                        <PublishedChangeHint
                          published={baseline.published_source_text}
                          working={sourceText}
                          released={released}
                        />
                      ) : null}
                    </div>
                    <Textarea
                      id="string-source"
                      className="min-h-24 resize-none text-sm leading-relaxed"
                      value={sourceText}
                      onChange={(e) => {
                        setMemoryUndo(null)
                        setSourceText(e.target.value)
                        setMemorySelection({ source: e.target.value, chosen: {} })
                      }}
                      rows={3}
                      aria-invalid={errors.source_text ? true : undefined}
                    />
                    <FieldError>{errors.source_text}</FieldError>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="string-description" className="text-xs font-medium">Description</FieldLabel>
                    <Input
                      id="string-description"
                      placeholder="Context for translators (optional)"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <div className="flex items-center gap-1">
                        <FieldLabel htmlFor="string-module" className="text-xs font-medium">Module</FieldLabel>
                        {released && baseline ? (
                          <PublishedChangeHint
                            published={baseline.published_module_slug ?? ''}
                            working={moduleSlug}
                            released={released}
                            mono
                          />
                        ) : null}
                        <CreateModulePopover
                          projectId={projectId}
                          disabled={busy}
                          onCreated={(created) => {
                            setCreatedModules((prev) =>
                              prev.some((item) => item.id === created.id) ? prev : [...prev, created],
                            )
                            setModuleId(created.id)
                          }}
                        />
                      </div>
                      <Select
                        value={moduleId || NONE_MODULE}
                        onValueChange={(v) => {
                          if (v === NONE_MODULE) {
                            setModuleId('')
                            return
                          }
                          // Native bubble <select> emits '' when the chosen id is not a
                          // mounted <option> yet (dropdown closed after inline create).
                          if (!v) return
                          setModuleId(v)
                        }}
                      >
                        <SelectTrigger id="string-module" className="w-full">
                          <SelectValue placeholder="— None —">
                            {selectedModuleName ?? '— None —'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={NONE_MODULE}>— None —</SelectItem>
                            {moduleOptions.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {moduleOptions.length === 0 ? (
                        <FieldDescription>
                          None yet. Create one without leaving this form.
                        </FieldDescription>
                      ) : null}
                    </Field>

                    <Field>
                      <div className="flex items-center gap-1">
                        <FieldLabel htmlFor="string-tag" className="text-xs font-medium">Tag</FieldLabel>
                        <CreateTagPopover
                          projectId={projectId}
                          tags={tagOptions}
                          disabled={busy}
                          onCreated={(created) => {
                            setCreatedTags((prev) =>
                              prev.some((item) => item.id === created.id) ? prev : [...prev, created],
                            )
                            setTagId(created.id)
                          }}
                        />
                      </div>
                      <Select
                        value={tagId || NONE_TAG}
                        onValueChange={(v) => {
                          if (v === NONE_TAG) {
                            setTagId('')
                            return
                          }
                          if (!v) return
                          setTagId(v)
                        }}
                      >
                        <SelectTrigger id="string-tag" className="w-full">
                          <SelectValue placeholder="— None —">
                            {selectedTag ? (
                              <span className="flex items-center gap-2">
                                <span
                                  className="size-2 rounded-full shrink-0"
                                  style={{ backgroundColor: selectedTag.color }}
                                />
                                <span>{selectedTag.name}</span>
                              </span>
                            ) : (
                              '— None —'
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={NONE_TAG}>— None —</SelectItem>
                            {tagOptions.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="size-2 rounded-full shrink-0"
                                    style={{ backgroundColor: t.color }}
                                  />
                                  <span>{t.name}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {tagOptions.length === 0 ? (
                        <FieldDescription>
                          None yet. Create one without leaving this form.
                        </FieldDescription>
                      ) : null}
                    </Field>
                  </div>
                </FieldGroup>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Translations {targetLocales.length > 0 ? `(${targetLocales.length})` : ''}
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canAutoTranslate || busy || memory.loading || aiLocales.length === 0}
                    onClick={() => {
                      setMemoryUndo(null)
                      translateMut.mutate({
                        locales: aiLocales,
                        overwrite: true,
                        source: sourceText,
                        current: translations,
                      })
                    }}
                    className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/30"
                  >
                    {translateMut.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Wand2 data-icon="inline-start" className="size-3.5" />
                    )}
                    {memoryLocales.length ? `Generate ${aiLocales.length} with AI` : 'Generate with AI'}
                  </Button>
                </div>
                {targetLocales.length > 0 ? (
                  <TranslationMemoryPanel
                    locales={targetLocales}
                    matches={memory.matches}
                    loading={memory.loading}
                    stale={memory.stale}
                    error={memory.error}
                    disabled={busy || Boolean(baseline?.deleted_at)}
                    selected={chosen}
                    onUse={(locale, match) => {
                      setMemoryUndo(null)
                      choosePublished(locale, match)
                    }}
                    onUseExact={useExactMatches}
                    onUndo={memoryUndo?.source === sourceText ? undoExactMatches : undefined}
                    onRetry={memory.retry}
                  />
                ) : null}
                {translateMut.isPending || translateMut.isSuccess ? (
                  <p className="text-xs text-muted-foreground">
                    {translateMut.isPending
                      ? 'Generating translations…'
                      : 'Review AI text, then Save. Add description context and Auto-translate again if needed.'}
                  </p>
                ) : null}
                {targetLocales.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No target locales configured for this project.
                  </p>
                ) : (
                  <FieldGroup className="gap-3">
                    {targetLocales.map((locale) => {
                      const view = qaViews[locale] ?? { status: 'unchecked' as const, issues: [], stale: false }
                      const issuesId = `qa-edit-${locale}`
                      return (
                      <Field key={locale} className="rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20" data-qa-status={view.status}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold uppercase rounded bg-muted/80 px-2 py-0.5 text-foreground shrink-0">
                            <FieldLabel htmlFor={`translation-${locale}`} className="uppercase font-mono text-xs font-bold cursor-pointer">
                              {locale}
                            </FieldLabel>
                          </span>
                          <ConfidenceBadge score={scores[locale]} />
                          {released && baseline ? (
                            <PublishedChangeHint
                              published={
                                baseline.translations.find((item) => item.locale === locale)
                                  ?.published_value
                              }
                              working={translations[locale] ?? ''}
                              released={released}
                            />
                          ) : null}
                          <span className="ml-auto">
                            <QaLocaleBadge view={view} locale={locale} footer={QA_SAVE_FOOTER} id={issuesId} />
                          </span>
                        </div>
                        <Textarea
                          id={`translation-${locale}`}
                          className="min-h-18 resize-none mt-2 text-sm leading-relaxed"
                          value={translations[locale] ?? ''}
                          onChange={(e) => {
                            setMemoryUndo(null)
                            const value = e.target.value
                            setTranslations((prev) => ({
                              ...prev,
                              [locale]: value,
                            }))
                            setScores((prev) => dropScore(prev, locale))
                            if (!value.trim()) setMemorySelection((prev) => {
                              if (!(locale in prev.chosen)) return prev
                              const next = { ...prev.chosen }
                              delete next[locale]
                              return { ...prev, chosen: next }
                            })
                          }}
                          rows={2}
                          autoComplete="off"
                          placeholder={`Translation for ${locale}…`}
                          aria-describedby={describedByFor(view, issuesId)}
                        />
                      </Field>
                      )
                    })}
                  </FieldGroup>
                )}
                <p className="text-xs text-muted-foreground">
                  QA re-checks a translation shortly after you stop typing. It never blocks Save.
                </p>
              </div>
            </div>
            </fieldset>
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-3 rounded-none border-t bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {canDiscard ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmDiscard(true)}
                >
                  {discardMut.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Undo2 data-icon="inline-start" />
                  )}
                  Discard changes
                </Button>
              ) : null}
              {saved && baseline && onViewInStrings ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onViewInStrings(baseline)}
                  className="border-primary/30 text-primary hover:bg-primary/5"
                >
                  View in Strings
                </Button>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="secondary"
                disabled={busy || Boolean(conflict) || Boolean(baseline?.deleted_at)}
              >
                {saveMut.isPending && <Spinner data-icon="inline-start" />}
                Save as draft
              </Button>
              <Button
                ref={publishButton}
                type="button"
                disabled={busy || Boolean(conflict) || Boolean(baseline?.deleted_at || baseline?.pending_delete)}
                onClick={() => submitAction('publish')}
              >
                {previewMut.isPending && <Spinner data-icon="inline-start" />}
                {isEdit ? 'Publish changes' : 'Create and publish'}
              </Button>
            </div>
          </DialogFooter>
        </form>
        )}
        <ConfirmDialog
          open={confirmUnpublish}
          onClose={() => setConfirmUnpublish(false)}
          onConfirm={() => unpublishMut.mutate()}
          title="Unpublish string?"
          description="This removes the string from public immediately. Unsaved form edits are kept and will not be saved."
          confirmLabel="Unpublish"
          isLoading={unpublishMut.isPending}
        />
        <ConfirmDialog
          open={confirmDiscard}
          onClose={() => setConfirmDiscard(false)}
          onConfirm={() => discardMut.mutate()}
          title="Discard working copy?"
          description={
            serverDiscardable && baseline?.pending_delete
              ? 'Cancels the pending removal and restores the last published text in staging. Unsaved edits in this form are lost.'
              : serverDiscardable
                ? 'Reverts staging to the last published snapshot. Production is unchanged. Unsaved edits in this form are lost.'
                : 'Resets this form to the last saved working copy.'
          }
          confirmLabel="Discard changes"
          isLoading={discardMut.isPending}
        />
      </DialogContent>
    </Dialog>
  )
}
