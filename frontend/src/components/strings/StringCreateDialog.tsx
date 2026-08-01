import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import type { Module, Tag } from '../../lib/api/types'
import { stringCreateSchema } from '../../lib/schemas'
import type { StringCreateForm } from '../../lib/schemas'
import {
  Dialog,
  DialogFooter,
  Button,
  Input,
  Textarea,
  Label,
  FormField,
  FormError,
  Select,
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
    <Dialog open onClose={onClose} title="Add string" className="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField>
          <Label htmlFor="key">Key</Label>
          <Input
            id="key"
            className="font-mono"
            placeholder="common.submit_button"
            value={form.key}
            onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            error={errors.key}
          />
          <FormError message={errors.key} />
        </FormField>

        <FormField>
          <Label htmlFor="source_text">Source text</Label>
          <Textarea
            id="source_text"
            placeholder="Submit"
            value={form.source_text}
            onChange={(e) => setForm((f) => ({ ...f, source_text: e.target.value }))}
            error={errors.source_text}
          />
          <FormError message={errors.source_text} />
        </FormField>

        <FormField>
          <Label htmlFor="description">Description (optional)</Label>
          <Input
            id="description"
            placeholder="Context for translators"
            value={form.description ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </FormField>

        {modules.length > 0 && (
          <FormField>
            <Label htmlFor="module_id">Module (optional)</Label>
            <Select
              id="module_id"
              value={form.module_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, module_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {tags.length > 0 && (
          <FormField>
            <Label>Tags (optional)</Label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const selected = form.tag_ids?.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        tag_ids: selected
                          ? (f.tag_ids ?? []).filter((id) => id !== t.id)
                          : [...(f.tag_ids ?? []), t.id],
                      }))
                    }
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      selected
                        ? 'bg-brand-50 text-brand-700 border-brand-300'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </button>
                )
              })}
            </div>
          </FormField>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={createMut.isPending}>
            Create string
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
