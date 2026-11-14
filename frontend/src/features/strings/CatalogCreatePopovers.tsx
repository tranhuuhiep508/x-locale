import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { modulesApi, tagsApi } from '@/lib/api/catalog'
import type { Module, Tag } from '@/lib/api/types'
import { ModuleFormFields } from '@/features/catalog/ModuleFormFields'
import { TagFormFields } from '@/features/catalog/TagFormFields'
import { queryKeys } from '@/lib/query-keys'
import { moduleCreateSchema, tagCreateSchema } from '@/lib/schemas'
import type { ModuleCreateForm, TagCreateForm } from '@/lib/schemas'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PendingLabel } from '@/components/ui/spinner'
import { useToast } from '@/lib/toast'
import { nextTagColor, tagSwatchColor } from './catalog-create'

type ModuleErrors = Partial<Record<keyof ModuleCreateForm, string>>
type TagErrors = Partial<Record<keyof TagCreateForm, string>>

const EMPTY_MODULE_FORM: ModuleCreateForm = {
  slug: '',
  name: '',
  description: '',
  translation_context: '',
}

function CreateModuleForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: string
  onCancel: () => void
  onCreated: (module: Module) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<ModuleCreateForm>(EMPTY_MODULE_FORM)
  const [errors, setErrors] = useState<ModuleErrors>({})

  const createMut = useMutation({
    mutationFn: (data: ModuleCreateForm) => modulesApi.create(projectId, data),
    onSuccess: (created) => {
      qc.setQueryData<Module[]>(queryKeys.projects.modules(projectId), (old) =>
        old ? [...old, created] : [created]
      )
      void qc.invalidateQueries({ queryKey: queryKeys.projects.modules(projectId) })
      toast.success('Module created')
      setForm(EMPTY_MODULE_FORM)
      setErrors({})
      onCreated(created)
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to create module'
      toast.error(message)
      if (message.toLowerCase().includes('already exists')) {
        setErrors((prev) => ({ ...prev, slug: message }))
      }
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    const result = moduleCreateSchema.safeParse(form)
    if (!result.success) {
      const next: ModuleErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ModuleCreateForm
        if (!next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    createMut.mutate(result.data)
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ModuleFormFields
          form={form}
          errors={errors}
          onChange={setForm}
          idPrefix="popover-module"
        />
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
        <Button variant="outline" type="button" onClick={onCancel} disabled={createMut.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={createMut.isPending}>
          <PendingLabel pending={createMut.isPending}>Create</PendingLabel>
        </Button>
      </div>
    </form>
  )
}

function CreateTagForm({
  projectId,
  tags,
  onCancel,
  onCreated,
}: {
  projectId: string
  tags: Tag[]
  onCancel: () => void
  onCreated: (tag: Tag) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<TagCreateForm>(() => ({
    name: '',
    color: nextTagColor(tags.map((item) => item.color)),
  }))
  const [errors, setErrors] = useState<TagErrors>({})

  const createMut = useMutation({
    mutationFn: (data: TagCreateForm) => tagsApi.create(projectId, data),
    onSuccess: (created) => {
      qc.setQueryData<Tag[]>(queryKeys.projects.tags(projectId), (old) =>
        old ? [...old, created] : [created]
      )
      void qc.invalidateQueries({ queryKey: queryKeys.projects.tags(projectId) })
      toast.success('Tag created')
      setForm({ name: '', color: nextTagColor([...tags, created].map((item) => item.color)) })
      setErrors({})
      onCreated(created)
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to create tag'
      toast.error(message)
      if (message.toLowerCase().includes('already exists')) {
        setErrors((prev) => ({ ...prev, name: message }))
      }
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    const result = tagCreateSchema.safeParse(form)
    if (!result.success) {
      const next: TagErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof TagCreateForm
        if (!next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    createMut.mutate(result.data)
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <TagFormFields form={form} errors={errors} onChange={setForm} idPrefix="popover-tag" />
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
        <Button variant="outline" type="button" onClick={onCancel} disabled={createMut.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={createMut.isPending}>
          <PendingLabel pending={createMut.isPending}>Create</PendingLabel>
        </Button>
      </div>
    </form>
  )
}

export function CreateModulePopover({
  projectId,
  disabled,
  onCreated,
}: {
  projectId: string
  disabled?: boolean
  onCreated: (module: Module) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={disabled}>
          <Plus data-icon="inline-start" />
          New
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-4"
        align="end"
      >
        <PopoverHeader className="shrink-0">
          <PopoverTitle>New module</PopoverTitle>
        </PopoverHeader>
        <CreateModuleForm
          projectId={projectId}
          onCancel={() => setOpen(false)}
          onCreated={(created) => {
            onCreated(created)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function CreateTagPopover({
  projectId,
  tags,
  disabled,
  onCreated,
}: {
  projectId: string
  tags: Tag[]
  disabled?: boolean
  onCreated: (tag: Tag) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={disabled}>
          <Plus data-icon="inline-start" />
          New
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-4"
        align="end"
      >
        <PopoverHeader className="shrink-0">
          <PopoverTitle>New tag</PopoverTitle>
        </PopoverHeader>
        <CreateTagForm
          projectId={projectId}
          tags={tags}
          onCancel={() => setOpen(false)}
          onCreated={(created) => {
            onCreated(created)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

const NONE_TAG = '__none__'

export function SingleTagField({
  id,
  projectId,
  tags,
  tagId,
  disabled,
  description,
  onSelect,
  onCreated,
}: {
  id: string
  projectId: string
  tags: Tag[]
  tagId: string
  disabled?: boolean
  description?: string
  onSelect: (tagId: string) => void
  onCreated: (tag: Tag) => void
}) {
  const selectedTag = tags.find((tag) => tag.id === tagId)
  const resolvedDescription =
    tags.length === 0 ? 'None yet. Create one without leaving this form.' : description

  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>Tag</FieldLabel>
        <CreateTagPopover
          projectId={projectId}
          tags={tags}
          disabled={disabled}
          onCreated={onCreated}
        />
      </div>
      <Select
        value={tagId || NONE_TAG}
        onValueChange={(value) => {
          if (value === NONE_TAG) {
            onSelect('')
            return
          }
          // Native bubble <select> emits '' when the chosen id is not a
          // mounted <option> yet (dropdown closed after inline create).
          if (!value) return
          onSelect(value)
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="— None —">
            {selectedTag ? (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tagSwatchColor(selectedTag.color) }}
                />
                <span className="truncate">{selectedTag.name}</span>
              </span>
            ) : (
              '— None —'
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NONE_TAG}>— None —</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tagSwatchColor(tag.color) }}
                  />
                  <span>{tag.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {resolvedDescription ? <FieldDescription>{resolvedDescription}</FieldDescription> : null}
    </Field>
  )
}
