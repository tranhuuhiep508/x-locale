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
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/lib/toast'
import { nextTagColor } from './catalog-create'

type ModuleErrors = Partial<Record<keyof ModuleCreateForm, string>>
type TagErrors = Partial<Record<keyof TagCreateForm, string>>

const EMPTY_MODULE_FORM: ModuleCreateForm = { slug: '', name: '', description: '' }

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
        old ? [...old, created] : [created],
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
    <form onSubmit={handleSubmit}>
      <ModuleFormFields
        form={form}
        errors={errors}
        onChange={setForm}
        idPrefix="popover-module"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel} disabled={createMut.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={createMut.isPending}>
          {createMut.isPending ? <Spinner data-icon="inline-start" /> : null}
          Create
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
        old ? [...old, created] : [created],
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
    <form onSubmit={handleSubmit}>
      <TagFormFields form={form} errors={errors} onChange={setForm} idPrefix="popover-tag" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel} disabled={createMut.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={createMut.isPending}>
          {createMut.isPending ? <Spinner data-icon="inline-start" /> : null}
          Create
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
      <PopoverContent className="w-[min(100vw-2rem,28rem)] p-4" align="end">
        <PopoverHeader className="mb-3">
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
      <PopoverContent className="w-[min(100vw-2rem,28rem)] p-4" align="end">
        <PopoverHeader className="mb-3">
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
