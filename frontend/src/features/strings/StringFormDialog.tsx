import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Undo2, Wand2 } from 'lucide-react'
import { stringsApi } from '@/lib/api/strings'
import { ApiError } from '@/lib/api/client'
import type {
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
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { CreateModulePopover, CreateTagPopover } from '@/features/strings/CatalogCreatePopovers'
import { TranslationMemoryPopover } from '@/features/strings/TranslationMemoryPopover'
import { useTranslationMemory } from '@/features/strings/use-translation-memory'
import { ConfidenceBadge, dropScore, mergeScores } from '@/features/strings/confidence'
import type { QaBaseline } from '@/features/strings/qa-issues'
import { describedByFor, QA_SAVE_FOOTER, QaLocaleBadge } from '@/features/strings/qa-issue-view'
import { useQaWatch, type QaWatchRow } from '@/features/strings/use-qa-watch'
import { PublishedChangeHint, canDiscardWorkingCopy, isReleased } from '@/features/strings/working-copy'
import { StringHistoryPanel } from '@/features/strings/StringHistoryPanel'
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
}

const NONE_MODULE = '__none__'

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
    status: TranslationStatus
    translations: Record<string, string>
    scores: Record<string, number>
  },
): boolean {
  if (values.key !== entry.key) return true
  if (values.sourceText !== entry.source_text) return true
  if (values.description !== (entry.description ?? '')) return true
  if (values.moduleId !== (entry.module_id ?? '')) return true
  if (JSON.stringify([...values.tagIds].sort()) !== JSON.stringify(entry.tags.map((tag) => tag.id).sort())) return true
  if (values.status !== entry.status) return true
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
}: Props) {
  const toast = useToast()
  const isEdit = Boolean(entry?.id)
  const [tab, setTab] = useState<'details' | 'history'>(initialTab)
  const [key, setKey] = useState(entry?.key ?? '')
  const [sourceText, setSourceText] = useState(entry?.source_text ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [moduleId, setModuleId] = useState(entry?.module_id ?? '')
  const [tagIds, setTagIds] = useState(() => entry?.tags.map((tag) => tag.id) ?? [])
  const tagId = tagIds[0] ?? ''
  const setTagId = (value: string) => setTagIds(value ? [value] : [])
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
  const [baseline, setBaseline] = useState(entry ?? null)
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const memory = useTranslationMemory(projectId, sourceText, targetLocales, entry?.id, baseline?.source_text)
  const [memorySelection, setMemorySelection] = useState<{ source: string; locales: string[] }>({ source: sourceText, locales: [] })
  const memoryLocales = memorySelection.source === sourceText ? memorySelection.locales : []
  const aiLocales = targetLocales.filter((locale) => !memoryLocales.includes(locale))
  const currentSource = useRef(sourceText)
  currentSource.current = sourceText

  function choosePublished(locale: string, match: TranslationMemoryMatch) {
    setTranslations((prev) => ({ ...prev, [locale]: match.translation }))
    setScores((prev) => dropScore(prev, locale))
    setQaSeeds((prev) => ({ ...prev, [locale]: { source: sourceText, text: match.translation, issues: match.issues } }))
    setMemorySelection({ source: sourceText, locales: [...new Set([...memoryLocales, locale])] })
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
  const selectedModuleName = moduleOptions.find((item) => item.id === moduleId)?.name

  const formValues = {
    key,
    sourceText,
    description,
    moduleId,
    tagIds,
    status,
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
      status?: TranslationStatus
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
    if (!isEdit || status !== baseline?.status) {
      body.status = status
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
    for (const field of ['key', 'source_text', 'description', 'module_id', 'tag_ids', 'status'] as const) {
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
          setMemorySelection((prev) => ({ ...prev, locales: prev.locales.filter((selected) => selected !== locale) }))
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
      source: entry?.source_text ?? '',
      text: entry?.translations.find((item) => item.locale === locale)?.value ?? '',
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

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isEdit && entry) {
        await stringsApi.update(projectId, entry.id, editPayload())
      } else {
        await stringsApi.create(projectId, payload())
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'String saved' : 'String created')
      onSuccess()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        const detail = (e.body as { detail?: SaveConflict & { code?: string } })?.detail
        if (detail?.code === 'stale_editor_save') {
          setConflict(detail)
          return
        }
      }
      toast.error(e instanceof Error ? e.message : `Failed to ${isEdit ? 'save' : 'create'} string`)
    },
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
      setQaSeeds({})
      setErrors({})
      onSuccess()
      toast.success('Working copy discarded')
    },
    onError: () => toast.error('Failed to discard changes'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (conflict || saveMut.isPending) return
    const nextErrors: FormErrors = {}
    if (!key.trim()) nextErrors.key = 'Key is required'
    if (!sourceText.trim()) nextErrors.source_text = 'Source text is required'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    saveMut.mutate()
  }

  const busy = saveMut.isPending || translateMut.isPending || discardMut.isPending
  const released = isEdit && baseline ? isReleased(baseline) : false
  const moduleSlug = moduleOptions.find((item) => item.id === moduleId)?.slug ?? ''
  const serverDiscardable = Boolean(baseline && canDiscardWorkingCopy(baseline))
  const formDirty = Boolean(baseline && isFormDirty(baseline, targetLocales, formValues))
  const canDiscard =
    isEdit && baseline && !baseline.deleted_at && (serverDiscardable || formDirty)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className={cn(
          'flex w-full flex-col gap-0 overflow-hidden p-0',
          'max-h-[min(90dvh,760px)] sm:max-w-3xl',
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
            {isEdit ? (
              <span className="rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground uppercase">
                {status}
              </span>
            ) : null}
          </div>
          <DialogDescription>
            {isEdit
              ? 'Update metadata and translations, or restore a previous version.'
              : 'Add metadata and translations. The string is created when you click Create.'}
          </DialogDescription>
          {isEdit ? (
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

        {isEdit && tab === 'history' && entry ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <StringHistoryPanel
              projectId={projectId}
              stringId={entry.id}
              onRestored={async () => {
                const fresh = await stringsApi.get(projectId, entry.id)
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
                setMemorySelection({ source: fresh.source_text, locales: [] })
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
            <div className="grid gap-6 p-5 sm:grid-cols-2 sm:gap-8">
              <FieldGroup className="gap-4">
                <Field data-invalid={errors.key ? 'true' : undefined}>
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor="string-key">Key</FieldLabel>
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
                    className="font-mono"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    aria-invalid={errors.key ? true : undefined}
                  />
                  <FieldError>{errors.key}</FieldError>
                </Field>

                <Field data-invalid={errors.source_text ? 'true' : undefined}>
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor="string-source">Source text</FieldLabel>
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
                    className="min-h-20 resize-none"
                    value={sourceText}
                    onChange={(e) => { setSourceText(e.target.value); setMemorySelection({ source: e.target.value, locales: [] }) }}
                    rows={3}
                    aria-invalid={errors.source_text ? true : undefined}
                  />
                  <FieldError>{errors.source_text}</FieldError>
                </Field>

                <Field>
                  <FieldLabel htmlFor="string-description">Description</FieldLabel>
                  <Input
                    id="string-description"
                    placeholder="Context for translators"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>

                <Field orientation="horizontal" className="items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/30 p-3.5">
                  <div className="flex flex-col gap-0.5">
                    <FieldLabel htmlFor="string-status">Published</FieldLabel>
                    <FieldDescription>
                      {isEdit
                        ? 'Saving edits does not change production. Turn on to publish the working copy; turn off to unpublish immediately.'
                        : 'Off keeps this string as draft; on publishes it after create.'}
                    </FieldDescription>
                  </div>
                  <Switch
                    id="string-status"
                    checked={status === 'public'}
                    disabled={Boolean(entry?.pending_delete || entry?.deleted_at)}
                    onCheckedChange={(checked) =>
                      setStatus(checked ? 'public' : 'draft')
                    }
                  />
                </Field>
                {isEdit && baseline?.has_unpublished_changes && !baseline.pending_delete ? (
                  <p className="text-sm text-muted-foreground">
                    Production still has the last published snapshot until you publish.
                  </p>
                ) : null}
                {entry?.deleted_at ? (
                  <p className="text-sm text-muted-foreground">
                    This string is deleted. Restore it from the grid to edit again.
                  </p>
                ) : null}
                {entry?.pending_delete ? (
                  <p className="text-sm text-muted-foreground">
                    Deletion is pending. Production still has the last published snapshot until you publish the removal.
                  </p>
                ) : null}

                <Field>
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor="string-module">Module</FieldLabel>
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
                    <FieldLabel>Tag</FieldLabel>
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
                  {tagOptions.length > 0 ? (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      className="flex flex-wrap justify-start"
                      value={tagId}
                      onValueChange={setTagId}
                    >
                      {tagOptions.map((t) => (
                        <ToggleGroupItem key={t.id} value={t.id} size="sm">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: t.color }}
                          />
                          {t.name}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  ) : (
                    <FieldDescription>
                      None yet. Create one without leaving this form.
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">Translations</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canAutoTranslate || busy || memory.loading || aiLocales.length === 0}
                    onClick={() => {
                      if (!memory.checked) { void memory.load(); return }
                      translateMut.mutate({
                        locales: aiLocales,
                        overwrite: true,
                        source: sourceText,
                        current: translations,
                      })
                    }}
                  >
                    {translateMut.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Wand2 data-icon="inline-start" />
                    )}
                    {memory.checked ? 'Generate with AI' : 'Auto-translate'}
                  </Button>
                </div>
                {translateMut.isPending || translateMut.isSuccess ? (
                  <p className="text-sm text-muted-foreground">
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
                      <Field key={locale} className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs transition-colors focus-within:border-primary/40" data-qa-status={view.status}>
                        <div className="flex items-center gap-2">
                          <FieldLabel htmlFor={`translation-${locale}`} className="uppercase font-mono text-xs font-semibold tracking-wider">
                            {locale}
                          </FieldLabel>
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
                          className="min-h-16 resize-none mt-1"
                          value={translations[locale] ?? ''}
                          onChange={(e) => {
                            const value = e.target.value
                            setTranslations((prev) => ({
                              ...prev,
                              [locale]: value,
                            }))
                            setScores((prev) => dropScore(prev, locale))
                            if (!value.trim()) setMemorySelection((prev) => ({ ...prev, locales: prev.locales.filter((selected) => selected !== locale) }))
                          }}
                          rows={2}
                          autoComplete="off"
                          placeholder={`Translation for ${locale}…`}
                          aria-describedby={describedByFor(view, issuesId)}
                        />
                        <TranslationMemoryPopover
                          locale={locale} matches={memory.matches[locale]} loading={memory.loading}
                          error={memory.error} stale={memory.stale} disabled={busy || Boolean(entry?.deleted_at)}
                          onRetry={() => { void memory.load() }} onUse={(match) => choosePublished(locale, match)}
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
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 flex-col rounded-none border-t bg-muted/40 px-5 py-3 sm:justify-between">
            <div>
              {canDiscard ? (
                <Button
                  type="button"
                  variant="outline"
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
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || Boolean(conflict) || Boolean(entry?.deleted_at)}>
                {saveMut.isPending && <Spinner data-icon="inline-start" />}
                {isEdit ? 'Save changes' : 'Create string'}
              </Button>
            </div>
          </DialogFooter>
        </form>
        )}
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
