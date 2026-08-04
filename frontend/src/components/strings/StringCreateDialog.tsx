import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import type { Module, Tag } from '../../lib/api/types'
import { stringCreateSchema } from '../../lib/schemas'
import type { StringCreateForm } from '../../lib/schemas'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Textarea,
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  ToggleGroup,
  ToggleGroupItem,
  Spinner,
} from '../ui'
import { useToast } from '../../store'

interface Props {
  projectId: string
  modules: Module[]
  tags: Tag[]
  onClose: () => void
  onSuccess: () => void
}

type FormErrors = Partial<Record<keyof StringCreateForm, string>>

const NONE_MODULE = '__none__'

export default function StringCreateDialog({
  projectId,
  modules,
  tags,
  onClose,
  onSuccess,
}: Props) {
  const toast = useToast()
  const [form, setForm] = useState<StringCreateForm>({
    key: '',
    source_text: '',
    description: '',
    module_id: '',
    tag_ids: [],
  })
  const [errors, setErrors] = useState<FormErrors>({})

  const createMut = useMutation({
    mutationFn: (data: StringCreateForm) =>
      api.post(`/projects/${projectId}/strings`, {
        key: data.key,
        source_text: data.source_text,
        description: data.description || undefined,
        module_id: data.module_id || undefined,
        tag_ids: data.tag_ids,
      }),
    onSuccess: () => {
      toast.success('String created')
      onSuccess()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create string'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = stringCreateSchema.safeParse(form)
    if (!result.success) {
      const errs: FormErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof StringCreateForm
        if (!errs[key]) errs[key] = issue.message
      }
      setErrors(errs)
      return
    }
    setErrors({})
    createMut.mutate(result.data)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add string</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field data-invalid={errors.key ? 'true' : undefined}>
              <FieldLabel htmlFor="key">Key</FieldLabel>
              <Input
                id="key"
                className="font-mono"
                placeholder="common.submit_button"
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                aria-invalid={errors.key ? true : undefined}
              />
              <FieldError>{errors.key}</FieldError>
            </Field>

            <Field data-invalid={errors.source_text ? 'true' : undefined}>
              <FieldLabel htmlFor="source_text">Source text</FieldLabel>
              <Textarea
                id="source_text"
                placeholder="Submit"
                value={form.source_text}
                onChange={(e) => setForm((f) => ({ ...f, source_text: e.target.value }))}
                aria-invalid={errors.source_text ? true : undefined}
              />
              <FieldError>{errors.source_text}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
              <Input
                id="description"
                placeholder="Context for translators"
                value={form.description ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>

            {modules.length > 0 && (
              <Field>
                <FieldLabel htmlFor="module_id">Module (optional)</FieldLabel>
                <Select
                  value={form.module_id || NONE_MODULE}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, module_id: v === NONE_MODULE ? '' : v }))
                  }
                >
                  <SelectTrigger id="module_id" className="w-full">
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
                <FieldLabel>Tags (optional)</FieldLabel>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  className="flex flex-wrap justify-start"
                  value={form.tag_ids ?? []}
                  onValueChange={(ids) => setForm((f) => ({ ...f, tag_ids: ids }))}
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

          <DialogFooter className="mt-6">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending && <Spinner data-icon="inline-start" />}
              Create string
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
