import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { AppShell } from '../../components/layout/AppShell'
import {
  Button,
  Input,
  Label,
  FormField,
  FormError,
  Select,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import type { Language, Project } from '../../lib/api/types'
import { queryKeys } from '../../lib/query-keys'
import { useToast } from '../../store'
import { projectCreateSchema } from '../../lib/schemas'
import type { ProjectCreateForm } from '../../lib/schemas'
import { slugify } from '../../lib/utils'

export const Route = createFileRoute('/projects/new')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: queryKeys.languages(),
      queryFn: () => api.get<Language[]>('/languages'),
    }),
  component: NewProjectPage,
})

type FormErrors = Partial<Record<keyof ProjectCreateForm, string>>

function NewProjectPage() {
  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: queryKeys.languages(),
    queryFn: () => api.get<Language[]>('/languages'),
  })

  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const [form, setForm] = useState<ProjectCreateForm>({
    name: '',
    slug: '',
    base_language: 'en',
    target_languages: [],
    layout: 'flat',
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})

  const createMut = useMutation({
    mutationFn: (data: ProjectCreateForm) =>
      api.post<Project>('/projects', {
        ...data,
        slug: data.slug || undefined,
      }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects() })
      toast.success(`Project "${project.name}" created`)
      navigate({ to: '/projects/$projectId/strings', params: { projectId: project.id }, search: {} })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create project'),
  })

  function handleNameChange(name: string) {
    setForm((f) => ({
      ...f,
      name,
      slug: slugTouched ? f.slug : slugify(name),
    }))
  }

  function toggleTargetLang(code: string) {
    setForm((f) => ({
      ...f,
      target_languages: f.target_languages.includes(code)
        ? f.target_languages.filter((l) => l !== code)
        : [...f.target_languages, code],
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = projectCreateSchema.safeParse(form)
    if (!result.success) {
      const errs: FormErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ProjectCreateForm
        if (!errs[key]) errs[key] = issue.message
      }
      setErrors(errs)
      return
    }
    setErrors({})
    createMut.mutate(result.data)
  }

  const targetLangs = languages.filter((l) => l.code !== form.base_language)

  return (
    <AppShell>
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        <Link to="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Link>

        <h1 className="text-xl font-semibold text-slate-900 mb-6">New project</h1>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <FormField>
            <Label htmlFor="name">Project name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My App"
              error={errors.name}
            />
            <FormError message={errors.name} />
          </FormField>

          <FormField>
            <Label htmlFor="slug">Slug (optional)</Label>
            <Input
              id="slug"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                setForm((f) => ({ ...f, slug: e.target.value }))
              }}
              placeholder="my-app"
              className="font-mono"
              error={errors.slug}
            />
            <FormError message={errors.slug} />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField>
              <Label htmlFor="base_language">Base language</Label>
              <Select
                id="base_language"
                value={form.base_language}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    base_language: e.target.value,
                    target_languages: f.target_languages.filter((l) => l !== e.target.value),
                  }))
                }
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name} ({l.code})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="layout">Layout</Label>
              <Select
                id="layout"
                value={form.layout}
                onChange={(e) =>
                  setForm((f) => ({ ...f, layout: e.target.value as 'flat' | 'modular' }))
                }
              >
                <option value="flat">Flat</option>
                <option value="modular">Modular</option>
              </Select>
            </FormField>
          </div>

          <FormField>
            <Label>Target languages</Label>
            {errors.target_languages && <FormError message={errors.target_languages} />}

            {form.target_languages.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.target_languages.map((code) => {
                  const lang = languages.find((l) => l.code === code)
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleTargetLang(code)}
                      className="flex items-center gap-1 px-2 py-0.5 bg-brand-50 text-brand-700 border border-brand-200 rounded-full text-xs hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                    >
                      {lang?.name ?? code}
                      <X className="h-3 w-3" />
                    </button>
                  )
                })}
              </div>
            )}

            <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-md p-2">
              {targetLangs.map((l) => {
                const selected = form.target_languages.includes(l.code)
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => toggleTargetLang(l.code)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs text-left transition-colors ${
                      selected
                        ? 'bg-brand-50 text-brand-700 border border-brand-200'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-mono text-[10px] text-slate-400 w-5">{l.code}</span>
                    {l.name}
                  </button>
                )
              })}
            </div>
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Link to="/">
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </Link>
            <Button type="submit" isLoading={createMut.isPending}>
              Create project
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
