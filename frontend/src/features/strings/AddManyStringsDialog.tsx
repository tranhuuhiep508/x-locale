import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { claimFinish, jobSuccessMessage, rememberJob, useActiveJobId } from '@/lib/active-job'
import { isJobAccepted } from '@/lib/api/jobs'
import { syncApi } from '@/lib/api/sync'
import { useJob } from '@/hooks/use-job'
import { JobProgress } from '@/components/job-progress'
import { importProgressLabel } from '@/lib/job-progress'
import type { ImportResult, Module, Project, Tag } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
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
import {
  emptyImportPreview,
  jsonMapToImportFormData,
  parseFlatI18nJson,
  PASTE_JSON_PLACEHOLDER,
  pasteImportParams,
} from '@/features/strings/paste-json'
import { hasImportWrites, ImportPreviewSummary } from '@/features/sync/ImportPreviewDialog'
import { useToast } from '@/lib/toast'

const NONE_MODULE = '__none__'

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
  onSuccess: () => void
}) {
  const toast = useToast()
  const isModular = project?.layout === 'modular'
  const locale = project?.base_language ?? 'en'

  const [text, setText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseWarning, setParseWarning] = useState<string | null>(null)
  const [moduleId, setModuleId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [createdModules, setCreatedModules] = useState<Module[]>([])
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const [step, setStep] = useState<'paste' | 'preview'>('paste')
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [pendingMap, setPendingMap] = useState<Record<string, string> | null>(null)
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const storedJobId = useActiveJobId(projectId, 'add')
  const trackedJobId = importJobId ?? storedJobId

  const moduleOptions = [
    ...modules,
    ...createdModules.filter((item) => !modules.some((m) => m.id === item.id)),
  ]
  const tagOptions = [...tags, ...createdTags.filter((item) => !tags.some((t) => t.id === item.id))]
  const selectedModuleName = moduleOptions.find((item) => item.id === moduleId)?.name

  function resetForm() {
    setText('')
    setParseError(null)
    setParseWarning(null)
    setModuleId('')
    setTagIds([])
    setCreatedModules([])
    setCreatedTags([])
    setStep('paste')
    setPreview(null)
    setPendingMap(null)
  }

  function closeDialog() {
    if (busy && !importJob.isError) return
    if (!trackedJobId) resetForm()
    onClose()
  }

  const importMut = useMutation({
    mutationFn: async ({ map, dry }: { map: Record<string, string>; dry: boolean }) => {
      const formData = jsonMapToImportFormData(map, locale)
      return syncApi.importFile(
        projectId,
        formData,
        pasteImportParams({
          locale,
          dry,
          moduleId: isModular ? moduleId : undefined,
          tagIds,
        })
      )
    },
    onSuccess: (result, { dry }) => {
      if (isJobAccepted(result)) {
        rememberJob({ jobId: result.job_id, projectId, kind: 'add', dryRun: dry })
        setImportJobId(result.job_id)
      } else showResult(result)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  })

  const importJob = useJob(trackedJobId, {
    onCompleted: (job) => {
      setImportJobId(null)
      const result = job.result as unknown as ImportResult
      if (result.dry_run) {
        claimFinish(job.id)
        setPreview(result)
        setStep('preview')
        return
      }
      if (claimFinish(job.id)) toast.success(jobSuccessMessage('add', job.result))
      resetForm()
      onSuccess()
    },
    onFailed: (error) => {
      setImportJobId(null)
      if (!trackedJobId || !claimFinish(trackedJobId)) return
      toast.error(error.message)
    },
  })

  function showResult(result: ImportResult) {
    if (result.dry_run) {
      setPreview(result)
      setStep('preview')
      return
    }
    toast.success(jobSuccessMessage('add', { created: result.created, updated: result.updated }))
    resetForm()
    onSuccess()
  }

  function handlePreview() {
    const parsed = parseFlatI18nJson(text)
    if (!parsed.ok) {
      setParseError(parsed.error)
      setParseWarning(null)
      setStep('paste')
      setPreview(null)
      setPendingMap(null)
      return
    }
    setParseError(null)
    setParseWarning(parsed.warning ?? null)
    setPendingMap(parsed.map)
    if (parsed.rows.length === 0) {
      setPreview(emptyImportPreview())
      setStep('preview')
      return
    }
    importMut.mutate({ map: parsed.map, dry: true })
  }

  function handleApply() {
    if (!pendingMap || !hasImportWrites(preview)) return
    importMut.mutate({ map: pendingMap, dry: false })
  }

  const busy = importMut.isPending || trackedJobId !== null
  const applyDisabled = pendingMap === null || !hasImportWrites(preview)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog()
      }}
    >
      <ReviewDialogContent
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
          <div className="flex items-center gap-2.5">
            <DialogTitle>Add many</DialogTitle>
            <span className="rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground uppercase">
              {step === 'paste' ? 'Step 1: Paste' : 'Step 2: Preview'}
            </span>
          </div>
          <DialogDescription>
            {step === 'paste'
              ? 'Paste a flat JSON object of key → source text. Preview runs a dry run before anything is written.'
              : 'Review creates and updates, then apply as one draft batch.'}
          </DialogDescription>
        </ReviewDialogHeader>

        <ReviewDialogBody>
          {parseWarning ? (
            <p role="status" className="mb-3 text-sm font-medium text-amber-600 dark:text-amber-400">
              {parseWarning}
            </p>
          ) : null}
          {step === 'paste' ? (
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
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={PASTE_JSON_PLACEHOLDER}
                  aria-invalid={parseError ? true : undefined}
                />
                <FieldDescription>
                  Values must be strings. Nested objects, arrays, and file upload stay on Import /
                  Export. New strings are saved as draft.
                </FieldDescription>
                <FieldError>{parseError}</FieldError>
              </Field>

              <FieldGroup className="min-w-0 flex flex-col gap-4 rounded-xl border border-border/70 bg-muted/20 p-4">
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
                    <FieldDescription>Applied to every row in this paste.</FieldDescription>
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
                    <FieldDescription>Shared across the whole batch, not per key.</FieldDescription>
                  ) : null}
                </Field>
              </FieldGroup>
            </FieldGroup>
          ) : (
            <>
              <ImportPreviewSummary result={preview} />
              {pendingMap === null ? (
                <FieldDescription>
                  Go back and paste the JSON again to run a fresh preview before applying.
                </FieldDescription>
              ) : null}
            </>
          )}
          {trackedJobId ? (
            <JobProgress
              className="pt-4"
              progress={importJob.data?.progress}
              error={importJob.isError ? importJob.error : undefined}
              onRetry={() => { void importJob.refetch() }}
              label={importProgressLabel(importJob.data?.progress)}
            />
          ) : null}
        </ReviewDialogBody>

        <ReviewDialogFooter>
          {step === 'paste' ? (
            <>
              <Button variant="outline" onClick={closeDialog} disabled={busy && !importJob.isError}>
                Cancel
              </Button>
              <Button onClick={handlePreview} disabled={busy}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Preview
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setStep('paste')
                  setPreview(null)
                }}
                disabled={busy}
              >
                Back
              </Button>
              <Button onClick={handleApply} disabled={busy || applyDisabled}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Apply
              </Button>
            </>
          )}
        </ReviewDialogFooter>
      </ReviewDialogContent>
    </Dialog>
  )
}
