import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { TranslationContextField } from '@/features/catalog/TranslationContextField'
import { TargetLanguagePicker } from '@/features/catalog/TargetLanguagePicker'
import { PageBody, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
    translation_context: '',
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
      navigate({
        to: '/projects/$projectRef/strings',
        params: { projectRef: project.slug },
        search: {},
      })
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
      <PageBody contained className="flex max-w-3xl flex-col gap-6">
        <div>
          <Link
            to="/"
            className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All projects
          </Link>
          <PageHeader
            eyebrow="Workspace"
            title="New project"
            description="Name the catalog, pick a base language, then add the locales you translate into."
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Project details</CardTitle>
            <CardDescription>Set up your catalog and the languages you work with.</CardDescription>
          </CardHeader>
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
                  <FieldLabel htmlFor="slug">Project URL (permanent)</FieldLabel>
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
                  <FieldDescription>
                    Generated from the name unless you change it. The URL cannot be changed later.
                  </FieldDescription>
                  <FieldError>{errors.slug}</FieldError>
                </Field>

                <FieldGroup className="grid gap-4 sm:grid-cols-2">
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
                </FieldGroup>

                <Field data-invalid={errors.target_languages ? 'true' : undefined}>
                  <FieldLabel>Target languages</FieldLabel>
                  <FieldError>{errors.target_languages}</FieldError>

                  <TargetLanguagePicker
                    languages={targetLangs}
                    value={form.target_languages}
                    onChange={(target_languages) => setForm((f) => ({ ...f, target_languages }))}
                  />
                </Field>

                <TranslationContextField
                  id="project_translation_context"
                  value={form.translation_context ?? ''}
                  error={errors.translation_context}
                  onChange={(translation_context) =>
                    setForm((f) => ({ ...f, translation_context }))
                  }
                />

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
      </PageBody>
    </AppShell>
  )
}
