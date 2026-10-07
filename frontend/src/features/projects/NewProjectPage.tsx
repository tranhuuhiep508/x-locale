import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ArrowLeft,
  Layers,
  Globe,
  Sparkles,
  Terminal,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { TranslationContextField } from '@/features/catalog/TranslationContextField'
import { TargetLanguagePicker } from '@/features/catalog/TargetLanguagePicker'
import { MarkWell, PageBody, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { cliInitCommand } from '@/lib/cli-connect'

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
  const previewName = form.name.trim() || 'My Application'
  const previewSlug = (form.slug ?? '').trim() || (form.name ? slugify(form.name) : 'my-application')

  return (
    <AppShell>
      <PageBody contained className="flex flex-col gap-6 pb-16">
        <div>
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to all projects
          </Link>
          <PageHeader
            eyebrow="Workspace"
            title="Create new project"
            description="Configure your translation catalog, choose base and target languages, and set context guidelines for AI translations."
          />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Main Form (8 cols on lg) */}
          <div className="min-w-0 lg:col-span-7 xl:col-span-8">
            <Card className="shadow-xs">
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle>Catalog Configuration</CardTitle>
                <CardDescription>
                  Enter project details and select the languages you plan to localize into.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <form onSubmit={handleSubmit}>
                  <FieldGroup className="space-y-6">
                    {/* Project Name & Slug Fields */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field data-invalid={errors.name ? 'true' : undefined}>
                        <FieldLabel htmlFor="name">Project name</FieldLabel>
                        <Input
                          id="name"
                          value={form.name}
                          onChange={(e) => handleNameChange(e.target.value)}
                          placeholder="Demo App"
                          aria-invalid={errors.name ? true : undefined}
                          className="h-9"
                        />
                        <FieldError>{errors.name}</FieldError>
                      </Field>

                      <Field data-invalid={errors.slug ? 'true' : undefined}>
                        <FieldLabel htmlFor="slug">Project URL (permanent)</FieldLabel>
                        <Input
                          id="slug"
                          value={form.slug ?? ''}
                          onChange={(e) => {
                            setSlugTouched(true)
                            setForm((f) => ({ ...f, slug: e.target.value }))
                          }}
                          placeholder="demo-app"
                          className="font-mono h-9"
                          aria-invalid={errors.slug ? true : undefined}
                        />
                        <FieldDescription>
                          Permanent unique slug for routing and CLI references.
                        </FieldDescription>
                        <FieldError>{errors.slug}</FieldError>
                      </Field>
                    </div>

                    {/* Base Language & Layout Fields */}
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
                          <SelectTrigger id="base_language" className="w-full h-9">
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
                        <FieldDescription>
                          Source language for your original codebase strings.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="layout">Layout</FieldLabel>
                        <Select
                          value={form.layout}
                          onValueChange={(v) =>
                            setForm((f) => ({ ...f, layout: v as 'flat' | 'modular' }))
                          }
                        >
                          <SelectTrigger id="layout" className="w-full h-9">
                            <SelectValue placeholder="Layout" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="flat">Flat (single file per locale)</SelectItem>
                              <SelectItem value="modular">Modular (grouped by module)</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          Determines export directory structure and CLI sync shape.
                        </FieldDescription>
                      </Field>
                    </FieldGroup>

                    {/* Target Languages */}
                    <Field data-invalid={errors.target_languages ? 'true' : undefined}>
                      <FieldLabel>Target languages</FieldLabel>
                      <FieldDescription className="mb-2">
                        Select one or more target locales that translators or AI will translate strings into.
                      </FieldDescription>
                      <FieldError>{errors.target_languages}</FieldError>

                      <TargetLanguagePicker
                        languages={targetLangs}
                        value={form.target_languages}
                        onChange={(target_languages) => setForm((f) => ({ ...f, target_languages }))}
                      />
                    </Field>

                    {/* AI Context Field */}
                    <TranslationContextField
                      id="project_translation_context"
                      value={form.translation_context ?? ''}
                      error={errors.translation_context}
                      onChange={(translation_context) =>
                        setForm((f) => ({ ...f, translation_context }))
                      }
                    />

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-3 border-t border-border/50 pt-5">
                      <Button variant="outline" type="button" asChild>
                        <Link to="/">Cancel</Link>
                      </Button>
                      <Button type="submit" disabled={createMut.isPending} className="shadow-xs min-w-32">
                        {createMut.isPending && <Spinner data-icon="inline-start" />}
                        Create project
                      </Button>
                    </div>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Live Project Preview & Architecture Notes */}
          <div className="min-w-0 space-y-6 lg:col-span-5 xl:col-span-4">
            <div className="sky-panel overflow-hidden rounded-xl border border-border/80 shadow-md">
              <div className="border-b border-border/60 bg-muted/40 px-4 py-3 flex items-center justify-between">
                <span className="eyebrow flex items-center gap-1.5 text-primary">
                  <Sparkles className="size-3.5" />
                  Live Preview
                </span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {form.layout}
                </Badge>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <MarkWell className="mt-0.5">
                    <Layers className="size-4" />
                  </MarkWell>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-base text-foreground">
                      {previewName}
                    </h3>
                    <p className="font-mono text-xs text-muted-foreground wrap-anywhere">
                      /projects/{previewSlug}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 border-t border-border/50 pt-3">
                  <span className="eyebrow text-[10px]">Language Matrix</span>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge variant="secondary" className="gap-1 font-mono text-[11px] font-semibold">
                      <Globe className="size-3 text-primary" />
                      {form.base_language.toUpperCase()}
                      <span className="text-[9px] text-muted-foreground font-normal">(base)</span>
                    </Badge>
                    {form.target_languages.length > 0 ? (
                      form.target_languages.map((lang) => (
                        <Badge key={lang} variant="outline" className="font-mono text-[11px]">
                          {lang.toUpperCase()}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        No target languages selected yet
                      </span>
                    )}
                  </div>
                </div>

                {form.translation_context && (
                  <div className="space-y-1 rounded-lg bg-muted/30 p-2.5 border border-border/60 text-xs">
                    <span className="eyebrow text-[10px] text-primary flex items-center gap-1">
                      <Sparkles className="size-3" />
                      AI Context Attached
                    </span>
                    <p className="text-muted-foreground line-clamp-3 italic">
                      "{form.translation_context}"
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t border-border/60 bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>0 strings (initial)</span>
                <span>Ready to initialize</span>
              </div>
            </div>

            {/* CLI Quick Hint Card */}
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-foreground font-semibold">
                <Terminal className="size-3.5 text-primary" />
                <span>Next step: CLI synchronization</span>
              </div>
              <p className="text-muted-foreground leading-relaxed text-[11px]">
                After creating this project, you can generate an API key in Settings and run{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground wrap-anywhere">
                  {cliInitCommand()}
                </code>{' '}
                in your repository to connect it. Then use <code>loc pull</code> and{' '}
                <code>loc push</code> to sync translation files.
              </p>
            </div>
          </div>
        </div>
      </PageBody>
    </AppShell>
  )
}
