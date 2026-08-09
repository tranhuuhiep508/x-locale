import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
import { cn, getRecordStatus } from '@/lib/utils'

interface Props {
  projectId: string
  entry: StringEntry
  modules: Module[]
  tags: Tag[]
  targetLocales: string[]
  onClose: () => void
  onSuccess: () => void
}

const NONE_MODULE = '__none__'

type FormErrors = Partial<Record<'key' | 'source_text', string>>

export default function StringEditDialog({
  projectId,
  entry,
  modules,
  tags,
  targetLocales,
  onClose,
  onSuccess,
}: Props) {
  const toast = useToast()
  const [key, setKey] = useState(entry.key)
  const [sourceText, setSourceText] = useState(entry.source_text)
  const [description, setDescription] = useState(entry.description ?? '')
  const [moduleId, setModuleId] = useState(entry.module_id ?? '')
  const [tagId, setTagId] = useState(entry.tags[0]?.id ?? '')
  const [status, setStatus] = useState<TranslationStatus>(() =>
    getRecordStatus(entry.translations, targetLocales),
  )
  const [translations, setTranslations] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const locale of targetLocales) {
      const existing = entry.translations.find((t) => t.locale === locale)
      map[locale] = existing?.value ?? ''
    }
    return map
  })
  const [errors, setErrors] = useState<FormErrors>({})

  const saveMut = useMutation({
    mutationFn: async () => {
      await api.patch(`/projects/${projectId}/strings/${entry.id}`, {
        key,
        source_text: sourceText,
        description,
        module_id: moduleId || null,
        tag_ids: tagId ? [tagId] : [],
      })

      const originalByLocale = Object.fromEntries(
        entry.translations.map((t) => [t.locale, t]),
      )

      await Promise.all(
        targetLocales.map(async (locale) => {
          const nextValue = translations[locale] ?? ''
          const prev = originalByLocale[locale]
          if (
            nextValue === (prev?.value ?? '') &&
            status === (prev?.status ?? 'draft')
          ) {
            return
          }
          await api.put(
            `/projects/${projectId}/strings/${entry.id}/translations/${locale}`,
            { value: nextValue, status },
          )
        }),
      )
    },
    onSuccess: () => {
      toast.success('String saved')
      onSuccess()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save string'),
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

  return (
    <Dialog open onOpenChange={(o) => !o && !saveMut.isPending && onClose()}>
      <DialogContent
        className={cn(
          'flex w-full flex-col gap-0 overflow-hidden p-0',
          'max-h-[min(90dvh,760px)] sm:max-w-3xl',
        )}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Edit string</DialogTitle>
          <DialogDescription>
            Update metadata and translations. Changes save when you click Save.
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
                  <FieldLabel htmlFor="edit-key">Key</FieldLabel>
                  <Input
                    id="edit-key"
                    className="font-mono"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    aria-invalid={errors.key ? true : undefined}
                  />
                  <FieldError>{errors.key}</FieldError>
                </Field>

                <Field data-invalid={errors.source_text ? 'true' : undefined}>
                  <FieldLabel htmlFor="edit-source">Source text</FieldLabel>
                  <Textarea
                    id="edit-source"
                    className="min-h-20 resize-none"
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    rows={3}
                    aria-invalid={errors.source_text ? true : undefined}
                  />
                  <FieldError>{errors.source_text}</FieldError>
                </Field>

                <Field>
                  <FieldLabel htmlFor="edit-description">Description</FieldLabel>
                  <Input
                    id="edit-description"
                    placeholder="Context for translators"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>

                <Field orientation="horizontal" className="items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <FieldLabel htmlFor="edit-status">Published</FieldLabel>
                    <FieldDescription>
                      Off keeps this string as draft; on marks it public.
                    </FieldDescription>
                  </div>
                  <Switch
                    id="edit-status"
                    checked={status === 'public'}
                    onCheckedChange={(checked) =>
                      setStatus(checked ? 'public' : 'draft')
                    }
                  />
                </Field>

                {modules.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor="edit-module">Module</FieldLabel>
                    <Select
                      value={moduleId || NONE_MODULE}
                      onValueChange={(v) =>
                        setModuleId(v === NONE_MODULE ? '' : v)
                      }
                    >
                      <SelectTrigger id="edit-module" className="w-full">
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
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: t.color }}
                          />
                          {t.name}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>
                )}
              </FieldGroup>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Translations</h3>
                {targetLocales.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No target locales configured for this project.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {targetLocales.map((locale) => (
                      <div
                        key={locale}
                        className="space-y-2 rounded-lg border bg-muted/15 p-3"
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
              disabled={saveMut.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveMut.isPending}>
              {saveMut.isPending && <Spinner data-icon="inline-start" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
