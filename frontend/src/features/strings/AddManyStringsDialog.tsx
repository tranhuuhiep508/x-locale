import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Wand2 } from 'lucide-react'
import { stringsApi } from '@/lib/api/strings'
import type {
  Module,
  PasteReviewRequest,
  PasteRow,
  PasteSaveResult,
  Project,
  StringEntry,
  Tag,
} from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CreateModulePopover, CreateTagPopover } from '@/features/strings/CatalogCreatePopovers'
import { ConfidenceBadge } from '@/features/strings/confidence'
import {
  aiTargetCells,
  cellId,
  chunk,
  draftRowsFromReview,
  draftRowsToRequest,
  isBlankJsonObject,
  parseFlatI18nJson,
  PASTE_AI_CHUNK,
  PASTE_JSON_PLACEHOLDER,
  PASTE_JSON_TEMPLATE,
  PASTE_JSON_TEMPLATE_CARET,
  PASTE_MAX_ROWS,
  pastedRows,
  type PasteDraftRow,
  valuesOf,
} from '@/features/strings/paste-json'
import {
  isPublishFingerprintMismatch,
  publicationErrorMessage,
} from '@/features/strings/publish-preview'
import { describedByFor, QA_APPLY_FOOTER, QaLocaleBadge } from '@/features/strings/qa-issue-view'
import type { QaBaseline, QaView } from '@/features/strings/qa-issues'
import { TranslatePublishReview } from '@/features/strings/TranslatePublishReview'
import { useQaWatch, type QaWatchRow } from '@/features/strings/use-qa-watch'
import { TranslateStepper } from '@/features/strings/TranslateReviewDialog'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const NONE_MODULE = '__none__'

const UNCHECKED: QaView = { status: 'unchecked', issues: [], stale: false }

const qaId = cellId

type Stage = 'paste' | 'edit' | 'review' | 'done'

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

/**
 * Add many: paste JSON, review the strings in place, optionally generate translations,
 * then Save as draft or Review & publish. Nothing is written until one of those saves.
 */
export function AddManyStringsDialog({
  open,
  projectId,
  project,
  modules,
  tags,
  onClose,
  onSuccess,
}: {
  open: boolean
  projectId: string
  project: Project | undefined
  modules: Module[]
  tags: Tag[]
  onClose: () => void
  /** Refresh after a save. A draft save stays open on its confirmation; a publish closes. */
  onSuccess: () => void
}) {
  const toast = useToast()
  const isModular = project?.layout === 'modular'
  const baseLocale = project?.base_language ?? 'en'
  const targetLocales = (project?.target_languages ?? []).filter((item) => item !== baseLocale)
  const localeOptions = [baseLocale, ...targetLocales]

  const [stage, setStage] = useState<Stage>('paste')
  const [text, setText] = useState(PASTE_JSON_TEMPLATE)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseWarning, setParseWarning] = useState<string | null>(null)
  const [chosenLocale, setChosenLocale] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [createdModules, setCreatedModules] = useState<Module[]>([])
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  // The pasted rows as first previewed; refreshes start from these, then reapply edits.
  const [pasted, setPasted] = useState<PasteRow[]>([])
  const [rows, setRows] = useState<PasteDraftRow[]>([])
  const [fingerprint, setFingerprint] = useState('')
  const [review, setReview] = useState<{
    entries: StringEntry[]
    fingerprint: string
    rows: PasteRow[]
  } | null>(null)
  const [saved, setSaved] = useState<PasteSaveResult | null>(null)
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // QA already returned with an AI translation, so that cell is not re-checked.
  const [qaSeeds, setQaSeeds] = useState<Record<string, QaBaseline>>({})
  // Cells AI filled and the user has not edited since; Generate may replace them again.
  const [aiCells, setAiCells] = useState<ReadonlySet<string>>(new Set())
  const session = useRef(0)

  const locale = localeOptions.includes(chosenLocale) ? chosenLocale : baseLocale
  const isBaseLocale = locale === baseLocale
  const moduleOptions = [
    ...modules,
    ...createdModules.filter((item) => !modules.some((m) => m.id === item.id)),
  ]
  const tagOptions = [...tags, ...createdTags.filter((item) => !tags.some((t) => t.id === item.id))]
  const selectedModuleName = moduleOptions.find((item) => item.id === moduleId)?.name
  const scope = (): Omit<PasteReviewRequest, 'rows'> => ({
    module_id: isModular && moduleId ? moduleId : null,
    tag_ids: tagIds,
  })

  function resetAll() {
    session.current += 1
    setStage('paste')
    setText(PASTE_JSON_TEMPLATE)
    setParseError(null)
    setParseWarning(null)
    setChosenLocale('')
    setModuleId('')
    setTagIds([])
    setCreatedModules([])
    setCreatedTags([])
    setPasted([])
    setRows([])
    setFingerprint('')
    setReview(null)
    setSaved(null)
    setAiProgress(null)
    setQaSeeds({})
    setAiCells(new Set())
  }

  const previewMut = useMutation({
    mutationFn: (request: PasteReviewRequest) => stringsApi.pasteReview(projectId, request),
    onError: (e) => toast.error(publicationErrorMessage(e, 'Could not preview the pasted strings')),
  })

  const reviewMut = useMutation({
    mutationFn: (request: PasteReviewRequest) => stringsApi.pasteReview(projectId, request),
    onSuccess: (result, request) => {
      if (result.fingerprint !== fingerprint) {
        refreshAfterConflict()
        return
      }
      setReview({
        entries: result.items.map((item) => item.entry),
        fingerprint: result.fingerprint,
        rows: request.rows,
      })
      setStage('review')
    },
    onError: (e) => toast.error(publicationErrorMessage(e, 'Could not prepare the publication review')),
  })

  /** Reload a stale catalog baseline, keeping the user's edits. */
  function refreshAfterConflict() {
    setReview(null)
    setStage('edit')
    previewMut.mutate(
      { ...scope(), rows: pasted },
      {
        onSuccess: (result) => {
          setRows((previous) => draftRowsFromReview(result, previous))
          setFingerprint(result.fingerprint)
        },
      }
    )
    toast.info('Some strings changed elsewhere. Check the refreshed list, then save again.')
  }

  const saveMut = useMutation({
    mutationFn: (request: Parameters<typeof stringsApi.pasteSave>[1]) =>
      stringsApi.pasteSave(projectId, request),
    onSuccess: (result) => {
      onSuccess()
      if (result.action === 'publish') {
        toast.success(
          `Saved and published ${result.published} ${result.published === 1 ? 'string' : 'strings'}`
        )
        resetAll()
        onClose()
        return
      }
      session.current += 1
      setSaved(result)
      setStage('done')
      toast.success(`Saved ${result.created + result.updated} strings as draft`)
    },
    onError: (e) => {
      if (isPublishFingerprintMismatch(e)) refreshAfterConflict()
      else toast.error(publicationErrorMessage(e, 'Failed to save strings'))
    },
  })

  function handlePreview() {
    const parsed = parseFlatI18nJson(text)
    if (!parsed.ok) {
      setParseError(parsed.error)
      setParseWarning(null)
      return
    }
    if (parsed.rows.length === 0) {
      setParseError('The JSON object is empty. Paste at least one key.')
      return
    }
    if (parsed.rows.length > PASTE_MAX_ROWS) {
      setParseError(
        `Paste up to ${PASTE_MAX_ROWS} keys at a time (got ${parsed.rows.length}). Use Import / Export for larger files.`
      )
      return
    }
    setParseError(null)
    setParseWarning(parsed.warning ?? null)
    const request = pastedRows(parsed.rows, locale, baseLocale)
    previewMut.mutate(
      { ...scope(), rows: request },
      {
        onSuccess: (result) => {
          setPasted(request)
          setRows(draftRowsFromReview(result))
          setFingerprint(result.fingerprint)
          setStage('edit')
        },
      }
    )
  }

  async function generateTranslations() {
    const replaceable = aiCells
    const cells = aiTargetCells(rows, targetLocales, replaceable)
    if (!cells.length) return
    const run = session.current
    const total = cells.length
    setAiProgress({ done: 0, total })
    let done = 0
    try {
      for (const items of chunk(cells, PASTE_AI_CHUNK)) {
        const result = await stringsApi.translatePreviewBatch(projectId, {
          module_id: isModular && moduleId ? moduleId : null,
          items,
        })
        if (session.current !== run) return
        const requested = new Map(items.map((item) => [item.id, item]))
        const byKey = new Map(result.items.map((item) => [item.id, item]))
        const seeds: Record<string, QaBaseline> = {}
        for (const item of result.items) {
          const asked = requested.get(item.id)
          if (!asked) continue
          for (const cell of asked.locales) {
            const text = item.translations[cell]
            if (text === undefined || !item.issues || !(cell in item.issues)) continue
            seeds[qaId(item.id, cell)] = { source: asked.source_text, text, issues: item.issues[cell] }
          }
        }
        setQaSeeds((previous) => ({ ...previous, ...seeds }))
        const filled: string[] = []
        setRows((previous) =>
          previous.map((row) => {
            const item = byKey.get(row.key)
            const asked = requested.get(row.key)
            // Drop results for a source edited meanwhile; never replace pasted or typed text.
            if (!item || !asked || asked.source_text !== row.source) return row
            const translations = { ...row.translations }
            const scores = { ...row.scores }
            for (const [cell, value] of Object.entries(item.translations)) {
              if (!asked.locales.includes(cell)) continue
              const id = cellId(row.key, cell)
              if ((translations[cell] ?? '').trim() && !replaceable.has(id)) continue
              translations[cell] = value
              scores[cell] = item.scores[cell] ?? null
              filled.push(id)
            }
            return { ...row, translations, scores }
          })
        )
        setAiCells((previous) => new Set([...previous, ...filled]))
        done += items.length
        setAiProgress({ done, total })
      }
    } catch {
      if (session.current === run) {
        toast.error('Translation failed — check AI translation credentials')
      }
    } finally {
      if (session.current === run) setAiProgress(null)
    }
  }

  function editRow(key: string, change: (row: PasteDraftRow) => PasteDraftRow) {
    setRows((previous) => previous.map((row) => (row.key === key ? change(row) : row)))
  }

  const aiBusy = aiProgress !== null
  const busy = previewMut.isPending || reviewMut.isPending || saveMut.isPending || aiBusy
  const hasWork = stage === 'edit' || stage === 'review'
  const missingCells = aiTargetCells(rows, targetLocales).reduce(
    (n, item) => n + item.locales.length,
    0
  )
  const aiTargets = aiTargetCells(rows, targetLocales, aiCells).length
  const anyTranslation = rows.some((row) =>
    targetLocales.some((cell) => (row.translations[cell] ?? '').trim())
  )
  const currentStep = stage === 'review' ? 2 : anyTranslation ? 1 : 0
  const stageOrder: Record<string, number> = { paste: 0, edit: 1, review: 2, done: 3 }
  const [prevStage, setPrevStage] = useState(stage)
  const [stageDirection, setStageDirection] = useState<'forward' | 'backward' | 'initial'>('initial')

  if (stage !== prevStage) {
    setStageDirection((stageOrder[stage] ?? 0) >= (stageOrder[prevStage] ?? 0) ? 'forward' : 'backward')
    setPrevStage(stage)
  }
  const qaRows: QaWatchRow[] = rows.flatMap((row) =>
    targetLocales.map((cell) => ({
      id: qaId(row.key, cell),
      locale: cell,
      source: row.source,
      text: row.translations[cell] ?? '',
      // Previewed text is already checked by the server; only edits are re-checked.
      baseline: qaSeeds[qaId(row.key, cell)] ?? {
        source: row.entry.source_text,
        text: valuesOf(row.entry)[cell] ?? '',
        issues: row.issues[cell],
      },
    }))
  )
  const qa = useQaWatch(projectId, qaRows, open && stage === 'edit' && !aiBusy)

  function requestClose() {
    if (busy) return
    if (hasWork) {
      setConfirmDiscard(true)
      return
    }
    resetAll()
    onClose()
  }

  function saveDraft() {
    saveMut.mutate({
      ...scope(),
      rows: draftRowsToRequest(rows, targetLocales),
      action: 'draft',
      fingerprint,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <ReviewDialogContent
        className={stage === 'paste' || stage === 'done' ? undefined : 'sm:max-w-4xl'}
        onFocusOutside={(event) => {
          event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isFocusOutsideEvent(event) || isNestedOverlayTarget(event.target)) {
            event.preventDefault()
          }
        }}
      >
        <ReviewDialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <DialogTitle>Add many</DialogTitle>
            {hasWork ? <TranslateStepper current={currentStep} /> : null}
          </div>
          <DialogDescription>
            {stage === 'paste'
              ? `Paste a flat JSON object of key → ${isBaseLocale ? 'source text' : `${locale.toUpperCase()} translation`}. Nothing is saved until you choose Save as draft or Publish.`
              : stage === 'edit'
                ? `${rows.length} pasted ${rows.length === 1 ? 'string' : 'strings'}. Add or generate translations, then save as draft or review and publish.`
                : stage === 'review'
                  ? 'Review the complete public content of every pasted string. Publish is the only confirmation.'
                  : 'Saved. Close, add more, or view these strings in the catalog.'}
          </DialogDescription>
        </ReviewDialogHeader>

        <ReviewDialogBody>
          {parseWarning && stage !== 'done' ? (
            <p role="status" className="mb-3 text-sm font-medium text-amber-600 dark:text-amber-400">
              {parseWarning}
            </p>
          ) : null}
          <div
            key={`stage-${stage}`}
            className={cn(
              'min-w-0 flex-1',
              stageDirection === 'initial'
                ? undefined
                : stageDirection === 'forward'
                  ? 'animate-step-in-right'
                  : 'animate-step-in-left'
            )}
          >
            {stage === 'paste' ? (
            <FieldGroup className="grid gap-6 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Field data-invalid={parseError ? true : undefined}>
                <FieldLabel htmlFor="add-many-json">JSON</FieldLabel>
                <Textarea
                  id="add-many-json"
                  className="min-h-44 resize-y font-mono text-xs sm:min-h-60 rounded-xl border-border/80 bg-muted/20 p-3.5 focus:bg-background transition-colors"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    if (parseError) setParseError(null)
                    if (parseWarning) setParseWarning(null)
                  }}
                  onFocus={(e) => {
                    if (text !== PASTE_JSON_TEMPLATE) return
                    const field = e.currentTarget
                    // After the click places the caret, move it inside the braces.
                    // Skip if, by then, the text changed or a selection was made (select-all
                    // then type would otherwise land inside the template braces).
                    requestAnimationFrame(() => {
                      if (field.value !== PASTE_JSON_TEMPLATE) return
                      if (field.selectionStart !== field.selectionEnd) return
                      field.setSelectionRange(PASTE_JSON_TEMPLATE_CARET, PASTE_JSON_TEMPLATE_CARET)
                    })
                  }}
                  onPaste={(e) => {
                    // A whole object pasted into the empty braces replaces them.
                    const pastedText = e.clipboardData.getData('text')
                    if (!isBlankJsonObject(text) || !pastedText.trim().startsWith('{')) return
                    e.preventDefault()
                    setText(pastedText)
                    if (parseError) setParseError(null)
                    if (parseWarning) setParseWarning(null)
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={PASTE_JSON_PLACEHOLDER}
                  aria-invalid={parseError ? true : undefined}
                />
                <FieldDescription>
                  One <code className="font-mono">"key": "value"</code> per line, at most{' '}
                  {PASTE_MAX_ROWS} keys. Nested objects, arrays, and larger files stay on Import /
                  Export.
                </FieldDescription>
                <FieldError>{parseError}</FieldError>
              </Field>

              <FieldGroup className="min-w-0 flex flex-col gap-4 rounded-xl border border-border/70 bg-muted/20 p-4">
                <Field>
                  <FieldLabel htmlFor="add-many-locale">Language</FieldLabel>
                  <Select value={locale} onValueChange={(v) => v && setChosenLocale(v)}>
                    <SelectTrigger id="add-many-locale" className="w-full">
                      <SelectValue>
                        {locale.toUpperCase()}
                        {isBaseLocale ? ' (source)' : ''}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {localeOptions.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item.toUpperCase()}
                            {item === baseLocale ? ' (source)' : ''}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {isBaseLocale
                      ? 'Values are source text.'
                      : 'Values are translations. AI keeps them and fills only empty languages.'}
                  </FieldDescription>
                </Field>
                {isModular ? (
                  <Field>
                    <div className="flex items-center gap-1">
                      <FieldLabel htmlFor="add-many-module">Module</FieldLabel>
                      <CreateModulePopover
                        projectId={projectId}
                        disabled={busy}
                        onCreated={(created) => {
                          setCreatedModules((prev) =>
                            prev.some((item) => item.id === created.id) ? prev : [...prev, created]
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
                        if (!v) return
                        setModuleId(v)
                      }}
                    >
                      <SelectTrigger id="add-many-module" className="w-full">
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
                    <FieldDescription>Applied to every new string in this paste.</FieldDescription>
                  </Field>
                ) : null}

                <Field>
                  <div className="flex items-center gap-1">
                    <FieldLabel>Tags</FieldLabel>
                    <CreateTagPopover
                      projectId={projectId}
                      tags={tagOptions}
                      disabled={busy}
                      onCreated={(created) => {
                        setCreatedTags((prev) =>
                          prev.some((item) => item.id === created.id) ? prev : [...prev, created]
                        )
                        setTagIds((prev) =>
                          prev.includes(created.id) ? prev : [...prev, created.id]
                        )
                      }}
                    />
                  </div>
                  {tagOptions.length > 0 ? (
                    <ToggleGroup
                      type="multiple"
                      variant="outline"
                      className="flex flex-wrap justify-start"
                      value={tagIds}
                      onValueChange={setTagIds}
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
                  {tagOptions.length > 0 ? (
                    <FieldDescription>Added to every pasted string.</FieldDescription>
                  ) : null}
                </Field>
              </FieldGroup>
            </FieldGroup>
          ) : stage === 'edit' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-2.5">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {aiProgress
                    ? `Generating translations… ${aiProgress.done}/${aiProgress.total} strings`
                    : missingCells
                      ? `${missingCells} empty ${missingCells === 1 ? 'translation' : 'translations'}. AI fills empty languages and can redo its own; it never replaces your text.`
                      : aiTargets
                        ? 'Every translation is filled. Generate again to redo AI translations you have not edited.'
                        : 'Every translation is filled. Review, then save.'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || aiTargets === 0}
                  onClick={() => void generateTranslations()}
                  className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/30"
                >
                  {aiBusy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Wand2 data-icon="inline-start" className="size-3.5" />
                  )}
                  Generate with AI
                </Button>
              </div>
              <ul className="flex flex-col gap-3" aria-label="Pasted strings">
                {rows.map((row) => {
                  const sourceEditable = isBaseLocale || row.mode === 'create'
                  return (
                    <li
                      key={row.key}
                      className="rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <code className="min-w-0 truncate font-mono text-xs font-medium" translate="no">
                          {row.key}
                        </code>
                        <Badge variant={row.mode === 'create' ? 'secondary' : 'outline'} className="text-[11px]">
                          {row.mode === 'create' ? 'New' : 'Update'}
                        </Badge>
                        {row.entry.status === 'public' ? (
                          <Badge variant="outline" className="text-[11px]">
                            Public
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 grid gap-2">
                        {sourceEditable ? (
                          <Textarea
                            aria-label={`Source text for ${row.key}`}
                            className="min-h-10 resize-none text-sm"
                            rows={1}
                            value={row.source}
                            disabled={busy}
                            onChange={(e) => {
                              const value = e.target.value
                              editRow(row.key, (r) => ({ ...r, source: value }))
                            }}
                          />
                        ) : (
                          <p className="rounded-md bg-muted/40 px-2.5 py-1.5 text-sm whitespace-pre-wrap">
                            {row.source}
                          </p>
                        )}
                        {targetLocales.map((cell) => {
                          const view = qa[qaId(row.key, cell)] ?? UNCHECKED
                          const issuesId = `qa-paste-${row.key}-${cell}`
                          return (
                            <div key={cell} className="flex items-start gap-2" data-qa-status={view.status}>
                              <span className="mt-2 w-8 shrink-0 font-mono text-[11px] font-bold uppercase text-muted-foreground">
                                {cell}
                              </span>
                              <Textarea
                                aria-label={`${cell.toUpperCase()} translation for ${row.key}`}
                                className="min-h-10 flex-1 resize-none text-sm"
                                rows={1}
                                value={row.translations[cell] ?? ''}
                                disabled={busy}
                                placeholder={`Translation for ${cell}…`}
                                aria-describedby={describedByFor(view, issuesId)}
                                onChange={(e) => {
                                  const value = e.target.value
                                  editRow(row.key, (r) => ({
                                    ...r,
                                    translations: { ...r.translations, [cell]: value },
                                    scores: { ...r.scores, [cell]: null },
                                  }))
                                  // An edited cell is the user's text now; AI won't redo it.
                                  setAiCells((previous) => {
                                    const id = cellId(row.key, cell)
                                    if (!previous.has(id)) return previous
                                    const next = new Set(previous)
                                    next.delete(id)
                                    return next
                                  })
                                }}
                              />
                              <span className="mt-2 shrink-0">
                                <ConfidenceBadge score={row.scores[cell] ?? undefined} />
                              </span>
                              <span className="mt-1.5 shrink-0">
                                <QaLocaleBadge
                                  view={view}
                                  locale={cell}
                                  footer={QA_APPLY_FOOTER}
                                  id={issuesId}
                                  showClean={false}
                                />
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : stage === 'review' ? (
            <TranslatePublishReview entries={review?.entries ?? null} loading={saveMut.isPending} />
          ) : saved ? (
            <div role="status" className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {saved.action === 'publish'
                      ? `Saved and published ${saved.published} ${saved.published === 1 ? 'string' : 'strings'}`
                      : `Saved ${saved.created + saved.updated} strings as draft`}
                  </p>
                  <p className="text-muted-foreground">
                    {saved.created} new · {saved.updated} updated.{' '}
                    {saved.action === 'publish'
                      ? 'Available on the next public pull or export.'
                      : 'Public content is unchanged until you publish.'}
                  </p>
                </div>
              </div>
              <div>
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/projects/$projectRef/strings"
                    params={{ projectRef: projectId }}
                    search={{ batch_id: saved.batch_id, batch_kind: 'import' }}
                    onClick={() => {
                      resetAll()
                      onClose()
                    }}
                  >
                    View in Strings
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
          </div>
        </ReviewDialogBody>

        <ReviewDialogFooter>
          {stage === 'paste' ? (
            <div
              key="paste-footer"
              className="flex w-full flex-wrap items-center justify-end gap-2 animate-step-fade"
            >
              <Button variant="outline" onClick={requestClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={handlePreview} disabled={busy}>
                {previewMut.isPending ? <Spinner data-icon="inline-start" /> : null}
                Preview
              </Button>
            </div>
          ) : stage === 'edit' ? (
            <div
              key="edit-footer"
              className="flex w-full flex-wrap items-center justify-end gap-2 animate-step-fade"
            >
              <Button
                variant="outline"
                className="mr-auto"
                disabled={busy}
                onClick={() => {
                  session.current += 1
                  setStage('paste')
                  setRows([])
                  setAiCells(new Set())
                  setQaSeeds({})
                }}
              >
                Back
              </Button>
              <Button variant="secondary" disabled={busy || !fingerprint} onClick={saveDraft}>
                {saveMut.isPending ? <Spinner data-icon="inline-start" /> : null}
                Save as draft
              </Button>
              <Button
                disabled={busy || !fingerprint}
                onClick={() =>
                  reviewMut.mutate({ ...scope(), rows: draftRowsToRequest(rows, targetLocales) })
                }
              >
                {reviewMut.isPending ? <Spinner data-icon="inline-start" /> : null}
                Review &amp; publish
              </Button>
            </div>
          ) : stage === 'review' ? (
            <div
              key="review-footer"
              className="flex w-full flex-wrap items-center justify-end gap-2 animate-step-fade"
            >
              <Button
                variant="outline"
                className="mr-auto"
                disabled={busy}
                onClick={() => {
                  setReview(null)
                  setStage('edit')
                }}
              >
                Back to edit
              </Button>
              <Button
                disabled={busy || !review}
                onClick={() =>
                  review &&
                  saveMut.mutate({
                    ...scope(),
                    rows: review.rows,
                    action: 'publish',
                    fingerprint: review.fingerprint,
                  })
                }
              >
                {saveMut.isPending ? <Spinner data-icon="inline-start" /> : null}
                Publish
              </Button>
            </div>
          ) : (
            <div
              key="done-footer"
              className="flex w-full flex-wrap items-center justify-end gap-2 animate-step-fade"
            >
              <Button variant="outline" onClick={resetAll}>
                Add more
              </Button>
              <Button onClick={requestClose}>Done</Button>
            </div>
          )}
        </ReviewDialogFooter>
        <ConfirmDialog
          open={confirmDiscard}
          onClose={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false)
            resetAll()
            onClose()
          }}
          title="Discard pasted strings?"
          description="Nothing has been saved. Your pasted strings and translations will be discarded."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
        />
      </ReviewDialogContent>
    </Dialog>
  )
}
