import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { languagesQuery } from '@/lib/queries'
import { projectsApi } from '@/lib/api/projects'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast'
import { projectCreateSchema } from '@/lib/schemas'
import type { ProjectCreateForm } from '@/lib/schemas'
import { slugify } from '@/lib/utils'

type FormErrors = Partial<Record<keyof ProjectCreateForm, string>>

export function NewProjectPage() {
  const { data: languages = [] } = useQuery(languagesQuery())

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
      projectsApi.create({
        ...data,
        slug: data.slug || undefined,
      }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
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
      <div className="container py-8">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Link>

        <h1 className="text-xl font-semibold text-foreground mb-6">New project</h1>

        <Card>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field data-invalid={errors.name ? 'true' : undefined}>
                  <FieldLabel htmlFor="name">Project name</FieldLabel>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="My App"
                    aria-invalid={errors.name ? true : undefined}
                  />
                  <FieldError>{errors.name}</FieldError>
                </Field>

                <Field data-invalid={errors.slug ? 'true' : undefined}>
                  <FieldLabel htmlFor="slug">Slug (optional)</FieldLabel>
                  <Input
                    id="slug"
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      setForm((f) => ({ ...f, slug: e.target.value }))
                    }}
                    placeholder="my-app"
                    className="font-mono"
                    aria-invalid={errors.slug ? true : undefined}
                  />
                  <FieldError>{errors.slug}</FieldError>
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="base_language">Base language</FieldLabel>
                    <Select
                      value={form.base_language}
                      onValueChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          base_language: v,
                          target_languages: f.target_languages.filter((l) => l !== v),
                        }))
                      }
                    >
                      <SelectTrigger id="base_language" className="w-full">
                        <SelectValue placeholder="Base language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {languages.map((l) => (
                            <SelectItem key={l.code} value={l.code}>
                              {l.name} ({l.code})
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="layout">Layout</FieldLabel>
                    <Select
                      value={form.layout}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, layout: v as 'flat' | 'modular' }))
                      }
                    >
                      <SelectTrigger id="layout" className="w-full">
                        <SelectValue placeholder="Layout" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="flat">Flat</SelectItem>
                          <SelectItem value="modular">Modular</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field data-invalid={errors.target_languages ? 'true' : undefined}>
                  <FieldLabel>Target languages</FieldLabel>
                  <FieldError>{errors.target_languages}</FieldError>

                  {form.target_languages.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {form.target_languages.map((code) => {
                        const lang = languages.find((l) => l.code === code)
                        return (
                          <Button
                            key={code}
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => toggleTargetLang(code)}
                          >
                            {lang?.name ?? code}
                            <X data-icon="inline-end" />
                          </Button>
                        )
                      })}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto border border-border rounded-md p-2">
                    {targetLangs.map((l) => {
                      const selected = form.target_languages.includes(l.code)
                      return (
                        <Button
                          key={l.code}
                          type="button"
                          variant={selected ? 'secondary' : 'ghost'}
                          size="sm"
                          className="justify-start"
                          onClick={() => toggleTargetLang(l.code)}
                        >
                          <span className="font-mono text-[10px] text-muted-foreground w-5">
                            {l.code}
                          </span>
                          {l.name}
                        </Button>
                      )
                    })}
                  </div>
                </Field>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" type="button" asChild>
                    <Link to="/">Cancel</Link>
                  </Button>
                  <Button type="submit" disabled={createMut.isPending}>
                    {createMut.isPending && <Spinner data-icon="inline-start" />}
                    Create project
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
