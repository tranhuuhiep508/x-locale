import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, Module, Project, Tag } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { PastePreviewPanel } from '@/features/strings/PastePreviewPanel'
import { buildPastePreview, hasPasteWrites, pasteCountLabel } from '@/features/strings/paste-preview'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

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
  const [moduleId, setModuleId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [createdModules, setCreatedModules] = useState<Module[]>([])
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const [step, setStep] = useState<'paste' | 'preview'>('paste')
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [pendingMap, setPendingMap] = useState<Record<string, string> | null>(null)

  const moduleOptions = [
    ...modules,
    ...createdModules.filter((item) => !modules.some((m) => m.id === item.id)),
  ]
  const tagOptions = [
    ...tags,
    ...createdTags.filter((item) => !tags.some((t) => t.id === item.id)),
  ]
  const selectedModuleName = moduleOptions.find((item) => item.id === moduleId)?.name

  useEffect(() => {
    if (!open) return
    setText('')
    setParseError(null)
    setModuleId('')
    setTagIds([])
    setCreatedModules([])
    setCreatedTags([])
    setStep('paste')
    setPreview(null)
    setPendingMap(null)
  }, [open])

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
        }),
      )
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  })

  function handlePreview() {
    const parsed = parseFlatI18nJson(text)
    if (!parsed.ok) {
      setParseError(parsed.error)
      setStep('paste')
      setPreview(null)
      setPendingMap(null)
      return
    }
    setParseError(null)
    setPendingMap(parsed.map)
    if (parsed.rows.length === 0) {
      setPreview(emptyImportPreview())
      setStep('preview')
      return
    }
    importMut.mutate(
      { map: parsed.map, dry: true },
      {
        onSuccess: (result) => {
          setPreview(result)
          setStep('preview')
        },
      },
    )
  }

  function handleApply() {
    if (!pendingMap || !hasPasteWrites(buildPastePreview(preview))) return
    importMut.mutate(
      { map: pendingMap, dry: false },
      {
        onSuccess: (result) => {
          toast.success(`Added ${result.created} · updated ${result.updated}`)
          onSuccess()
        },
      },
    )
  }

  const busy = importMut.isPending
  const pastePreview = buildPastePreview(preview)
  const applyDisabled = !hasPasteWrites(pastePreview)
  const countLabel = pasteCountLabel(pastePreview.counts)
  const previewDescription = applyDisabled
    ? 'Nothing in this paste would create or update strings.'
    : countLabel
      ? `${countLabel}. Apply writes a draft batch; Back or Cancel leaves the catalog unchanged.`
      : 'Apply writes a draft batch; Back or Cancel leaves the catalog unchanged.'

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent
        className={cn(
          'flex w-full flex-col gap-0 overflow-hidden p-0',
          'max-h-[min(90dvh,840px)] sm:max-w-2xl',
        )}
        onFocusOutside={(event) => {
          event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isFocusOutsideEvent(event) || isNestedOverlayTarget(event.target)) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Add many</DialogTitle>
          <DialogDescription>
            {step === 'paste'
              ? 'Paste a flat JSON object of key → source text. Preview runs a dry run before anything is written.'
              : previewDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {step === 'paste' ? (
            <FieldGroup>
              <Field data-invalid={parseError ? true : undefined}>
                <FieldLabel htmlFor="add-many-json">JSON</FieldLabel>
                <Textarea
                  id="add-many-json"
                  className="min-h-44 resize-y font-mono text-xs"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    if (parseError) setParseError(null)
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

              {isModular ? (
                <Field>
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor="add-many-module">Module</FieldLabel>
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
                        prev.some((item) => item.id === created.id) ? prev : [...prev, created],
                      )
                      setTagIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]))
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
                        <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : (
                  <FieldDescription>None yet. Create one without leaving this form.</FieldDescription>
                )}
                {tagOptions.length > 0 ? (
                  <FieldDescription>Shared across the whole batch, not per key.</FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
          ) : (
            <PastePreviewPanel result={preview} />
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-muted/40 px-5 py-3 sm:justify-end">
          {step === 'paste' ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={busy}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
