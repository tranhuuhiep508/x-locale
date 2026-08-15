import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import type {
  Module,
  StringEntry,
  Tag,
  TranslationStatus,
} from '@/lib/api/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  Button,
  Input,
  Textarea,
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  ToggleGroup,
  ToggleGroupItem,
  Switch,
  Spinner,
} from '@/components/ui'
import { useToast } from '@/store'
import { cn } from '@/lib/utils'

interface Props {
  projectId: string
  entry?: StringEntry | null
  modules: Module[]
  tags: Tag[]
  targetLocales: string[]
  onClose: () => void
  onSuccess: () => void
}

interface TranslatePreviewResult {
  translations: Record<string, string>
}

const NONE_MODULE = '__none__'

type FormErrors = Partial<Record<'key' | 'source_text', string>>

export default function StringFormDialog({
  projectId,
  entry,
  modules,
  tags,
  targetLocales,
  onClose,
  onSuccess,
}: Props) {
  const toast = useToast()
  const isEdit = Boolean(entry?.id)
  const [key, setKey] = useState(entry?.key ?? '')
  const [sourceText, setSourceText] = useState(entry?.source_text ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [moduleId, setModuleId] = useState(entry?.module_id ?? '')
  const [tagId, setTagId] = useState(entry?.tags[0]?.id ?? '')
  const [status, setStatus] = useState<TranslationStatus>(() => entry?.status ?? 'draft')
  const [translations, setTranslations] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const locale of targetLocales) {
      const existing = entry?.translations.find((t) => t.locale === locale)
      map[locale] = existing?.value ?? ''
    }
    return map
  })
  const [errors, setErrors] = useState<FormErrors>({})

  const canAutoTranslate =
    key.trim().length > 0 && sourceText.trim().length > 0 && targetLocales.length > 0

  const payload = () => ({
    key: key.trim(),
    source_text: sourceText.trim(),
    description: description.trim() || null,
    module_id: moduleId || null,
    tag_ids: tagId ? [tagId] : [],
    status,
    translations,
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = payload()
      if (isEdit && entry) {
        await api.patch(`/projects/${projectId}/strings/${entry.id}`, body)
      } else {
        await api.post(`/projects/${projectId}/strings`, body)
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'String saved' : 'String created')
      onSuccess()
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : `Failed to ${isEdit ? 'save' : 'create'} string`),
  })

  const translateMut = useMutation({
    mutationFn: () =>
      api.post<TranslatePreviewResult>(`/projects/${projectId}/translate/preview`, {
        source_text: sourceText.trim(),
        description: description.trim() || undefined,
        locales: targetLocales,
      }),
    onSuccess: (res) => {
      setTranslations((prev) => ({ ...prev, ...res.translations }))
      toast.success('Translations filled')
    },
    onError: () => toast.error('Translation failed — check Bedrock credentials'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const nextErrors: FormErrors = {}
    if (!key.trim()) nextErrors.key = 'Key is required'
    if (!sourceText.trim()) nextErrors.source_text = 'Source text is required'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    saveMut.mutate()
  }

  const busy = saveMut.isPending || translateMut.isPending

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className={cn(
          'flex w-full flex-col gap-0 overflow-hidden p-0',
          'max-h-[min(90dvh,760px)] sm:max-w-3xl',
        )}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>{isEdit ? 'Edit string' : 'Add string'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update metadata and translations. Changes save when you click Save.'
              : 'Add metadata and translations. The string is created when you click Create.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="grid gap-6 p-5 md:grid-cols-2 md:gap-8">
              <FieldGroup className="gap-4">
                <Field data-invalid={errors.key ? 'true' : undefined}>
                  <FieldLabel htmlFor="string-key">Key</FieldLabel>
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
                  <FieldLabel htmlFor="string-source">Source text</FieldLabel>
                  <Textarea
                    id="string-source"
                    className="min-h-20 resize-none"
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
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

                <Field orientation="horizontal" className="items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <FieldLabel htmlFor="string-status">Published</FieldLabel>
                    <FieldDescription>
                      Off keeps this string as draft; on marks it public.
                    </FieldDescription>
                  </div>
                  <Switch
                    id="string-status"
                    checked={status === 'public'}
                    onCheckedChange={(checked) =>
                      setStatus(checked ? 'public' : 'draft')
                    }
                  />
                </Field>

                {modules.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor="string-module">Module</FieldLabel>
                    <Select
                      value={moduleId || NONE_MODULE}
                      onValueChange={(v) =>
                        setModuleId(v === NONE_MODULE ? '' : v)
                      }
                    >
                      <SelectTrigger id="string-module" className="w-full">
                        <SelectValue placeholder="— None —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={NONE_MODULE}>— None —</SelectItem>
                          {modules.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                {tags.length > 0 && (
                  <Field>
                    <FieldLabel>Tag</FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      className="flex flex-wrap justify-start"
                      value={tagId}
                      onValueChange={setTagId}
                    >
                      {tags.map((t) => (
                        <ToggleGroupItem key={t.id} value={t.id} size="sm">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: t.color }}
                          />
                          {t.name}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>
                )}
              </FieldGroup>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">Translations</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canAutoTranslate || busy}
                    onClick={() => translateMut.mutate()}
                  >
                    {translateMut.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Wand2 data-icon="inline-start" />
                    )}
                    Auto-translate
                  </Button>
                </div>
                {targetLocales.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No target locales configured for this project.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {targetLocales.map((locale) => (
                      <div
                        key={locale}
                        className="flex flex-col gap-2 rounded-lg border bg-muted/15 p-3"
                      >
                        <span className="text-sm font-medium uppercase tracking-wide">
                          {locale}
                        </span>
                        <Textarea
                          className="min-h-16 resize-none"
                          value={translations[locale] ?? ''}
                          onChange={(e) =>
                            setTranslations((prev) => ({
                              ...prev,
                              [locale]: e.target.value,
                            }))
                          }
                          rows={2}
                          placeholder={`Translation for ${locale}…`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-muted/40 px-5 py-3 sm:justify-end">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {saveMut.isPending && <Spinner data-icon="inline-start" />}
              {isEdit ? 'Save changes' : 'Create string'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
