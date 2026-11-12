import { getRouteApi } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type PaginationState,
} from '@tanstack/react-table'
import { Plus, TriangleAlert, Terminal, KeyRound, ShieldAlert, Sparkles, FolderTree } from 'lucide-react'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { CopyableSecretField } from '@/components/copyable-secret-field'
import { apiKeyColumns } from '@/features/settings/api-keys-columns'
import { projectsApi } from '@/lib/api/projects'
import { projectSettingsSchema, type ProjectSettingsForm } from '@/lib/schemas'
import { TranslationContextField } from '@/features/catalog/TranslationContextField'
import { TargetLanguagePicker } from '@/features/catalog/TargetLanguagePicker'
import type { ApiKey, ApiKeyCreated } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { languagesQuery, meQuery, projectApiKeysQuery, projectMembersQuery, projectQuery } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { PageBody, PageHeader, PageSection } from '@/components/layout/PageHeader'
import { ProjectMembersSection } from '@/features/settings/ProjectMembersSection'
import { useToast } from '@/lib/toast'
import { cliInitCommand } from '@/lib/cli-connect'
const routeApi = getRouteApi('/projects/$projectRef/settings')

export function SettingsPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: project } = useQuery(projectQuery(projectId))
  const { data: me } = useQuery(meQuery())
  const membersQuery = useQuery(projectMembersQuery(projectId))

  const { data: languages = [] } = useQuery(languagesQuery())
  const defaultKeyName = me?.email || 'Default'

  const { data: apiKeys = [] } = useQuery(projectApiKeysQuery(projectId))
  const apiKeyData = useMemo(() => apiKeys, [apiKeys])
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const [apiKeyPagination, setApiKeyPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })

  const [saveForm, setSaveForm] = useState<ProjectSettingsForm | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof ProjectSettingsForm, string>>>({})

  const form = saveForm ?? {
    name: project?.name ?? '',
    base_language: project?.base_language ?? 'en',
    target_languages: project?.target_languages ?? [],
    layout: project?.layout ?? 'flat',
    allow_duplicate_keys: project?.allow_duplicate_keys ?? false,
    translation_context: project?.translation_context ?? '',
  }

  const updateMut = useMutation({
    mutationFn: (data: typeof form) => projectsApi.update(projectId, data),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.projects.detail(projectId), updated)
      qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
      toast.success('Settings saved')
      setSaveForm(null)
      setErrors({})
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save'),
  })

  function saveSettings() {
    const result = projectSettingsSchema.safeParse(form)
    if (!result.success) {
      const next: typeof errors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ProjectSettingsForm
        if (!next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    updateMut.mutate(result.data)
  }

  const [showNewKey, setShowNewKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)
  const [deleteKeyTarget, setDeleteKeyTarget] = useState<ApiKey | null>(null)

  function openGenerateKey() {
    setNewKeyName(defaultKeyName)
    setShowNewKey(true)
  }

  const createKeyMut = useMutation({
    mutationFn: (name: string) => projectsApi.createApiKey(projectId, name),
    onSuccess: (key) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.apiKeys(projectId) })
      setCreatedKey(key)
      setShowNewKey(false)
      setNewKeyName('')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to generate key'),
  })

  const revokeKeyMut = useMutation({
    mutationFn: (id: string) => projectsApi.revokeApiKey(projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.apiKeys(projectId) })
      toast.success('API key revoked')
      setDeleteKeyTarget(null)
    },
    onError: () => toast.error('Failed to revoke key'),
  })

  const isAdmin = project?.role === 'admin'
  const apiKeyTable = useReactTable({
    data: apiKeyData,
    columns: apiKeyColumns,
    state: { globalFilter: apiKeyFilter, pagination: apiKeyPagination },
    onGlobalFilterChange: setApiKeyFilter,
    onPaginationChange: setApiKeyPagination,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSorting: false,
    globalFilterFn: 'includesString',
    meta: {
      onRevoke: setDeleteKeyTarget,
      canRevoke: (key: ApiKey) => isAdmin || (me?.id != null && key.created_by === me.id),
    },
  })

  if (!project) return null
  const targetLangs = languages.filter((l) => l.code !== form.base_language)
  const isDirty = saveForm !== null

  return (
    <PageBody
      className="mx-auto w-full max-w-6xl pb-12"
      data-tour-ready={membersQuery.isSuccess ? 'settings' : undefined}
    >
      <PageHeader
        className="border-b border-border/70 pb-3"
        title="Settings"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {project.slug}
            </Badge>
            <Badge variant="secondary" className="capitalize">
              {form.layout} layout
            </Badge>
          </div>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Sticky Architectural Section Rail */}
        <nav
          aria-label="Settings sections"
          className="hidden lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-1.5"
        >
          <span className="eyebrow mb-1 px-2.5 text-[10px]">Configuration</span>
          <a
            href="#settings-general-section"
            className="flex items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-foreground/85 transition-colors hover:border-border/70 hover:bg-muted/50 hover:text-foreground"
          >
            <span>Catalog & Locales</span>
            {isDirty ? (
              <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
            ) : null}
          </a>
          <a
            href="#settings-context-section"
            className="flex items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-foreground/85 transition-colors hover:border-border/70 hover:bg-muted/50 hover:text-foreground"
          >
            <span>AI Context</span>
          </a>
          <Separator className="my-1" />
          <span className="eyebrow mb-1 px-2.5 text-[10px]">Access & Sync</span>
          <a
            href="#settings-members-section"
            className="flex items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-foreground/85 transition-colors hover:border-border/70 hover:bg-muted/50 hover:text-foreground"
          >
            <span>Members</span>
          </a>
          <a
            href="#settings-api-keys-section"
            className="flex items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-foreground/85 transition-colors hover:border-border/70 hover:bg-muted/50 hover:text-foreground"
          >
            <span>API Keys & CLI</span>
            <Badge variant="outline" className="font-mono text-[10px] tabular-nums">
              {apiKeys.length}
            </Badge>
          </a>
        </nav>

        <div className="flex min-w-0 flex-col gap-8">
          <div id="settings-general-section" data-tour="settings-general" className="flex flex-col gap-8">
            <PageSection
              title="Project details"
              description="Choose the name, source language, and file layout for your catalog."
            >
              <Card className="relative overflow-hidden border-border/80 shadow-xs">
                <div
                  className="animate-meridian-stream absolute inset-x-0 top-0 h-px"
                  aria-hidden="true"
                />
                <CardHeader className="border-b border-border/60 bg-muted/15">
                  <CardTitle className="text-sm">Catalog identity & export policy</CardTitle>
                  <CardDescription>
                    Controls how strings are indexed in the studio and structured on CLI pull.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-5">
                  <FieldGroup>
                    <Field data-invalid={errors.name ? 'true' : undefined}>
                      <FieldLabel htmlFor="project_name">Project name</FieldLabel>
                      <Input
                        id="project_name"
                        value={form.name}
                        disabled={!isAdmin}
                        aria-invalid={errors.name ? true : undefined}
                        onChange={(e) => setSaveForm((f) => ({ ...(f ?? form), name: e.target.value }))}
                      />
                      <FieldError>{errors.name}</FieldError>
                    </Field>

                    <FieldGroup className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="base_language">Base language</FieldLabel>
                        <Select
                          value={form.base_language}
                          disabled={!isAdmin || !project?.can_change_base_language}
                          onValueChange={(v) =>
                            setSaveForm((f) => ({
                              ...(f ?? form),
                              base_language: v,
                              target_languages: (f ?? form).target_languages.filter((l) => l !== v),
                            }))
                          }
                        >
                          <SelectTrigger id="base_language" className="w-full" aria-describedby="base_language_help">
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
                        <FieldDescription id="base_language_help">
                          Base language can only be changed before any strings are added, including deleted strings.
                          To use a different base language afterward, create a new project.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <div className="flex items-center justify-between">
                          <FieldLabel htmlFor="layout">Layout</FieldLabel>
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <FolderTree className="size-3" />
                            {form.layout === 'modular' ? 'Folder per module' : 'Single file per locale'}
                          </span>
                        </div>
                        <Select
                          value={form.layout}
                          disabled={!isAdmin}
                          onValueChange={(v) =>
                            setSaveForm((f) => ({
                              ...(f ?? form),
                              layout: v as 'flat' | 'modular',
                            }))
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
                    <Separator />
                    <Field data-tour="dup-keys" orientation="horizontal" data-disabled={!isAdmin || undefined}>
                      <div className="flex flex-1 flex-col gap-1">
                        <FieldLabel htmlFor="allow_duplicate_keys">Allow duplicate keys across modules</FieldLabel>
                        <FieldDescription id="allow_duplicate_keys_description">
                          Allow the same key in different modules. Keys must still be unique within each module.
                        </FieldDescription>
                      </div>
                      <Switch
                        id="allow_duplicate_keys"
                        aria-describedby="allow_duplicate_keys_description"
                        checked={form.allow_duplicate_keys}
                        disabled={!isAdmin}
                        onCheckedChange={(allow_duplicate_keys) =>
                          setSaveForm((f) => ({ ...(f ?? form), allow_duplicate_keys }))
                        }
                      />
                    </Field>
                  </FieldGroup>
                </CardContent>
              </Card>
            </PageSection>

            <PageSection
              title="Target languages"
              description="Select the languages you translate into. The source language is excluded."
            >
              <Card className="relative overflow-hidden border-border/80 shadow-xs">
                <CardContent className="pt-5">
                  <TargetLanguagePicker
                    languages={targetLangs}
                    value={form.target_languages}
                    disabled={!isAdmin}
                    onChange={(target_languages) =>
                      setSaveForm((f) => ({ ...(f ?? form), target_languages }))
                    }
                  />
                </CardContent>
              </Card>
            </PageSection>
          </div>

          <div id="settings-context-section" data-tour="settings-context">
            <PageSection
              title="Translation context"
              description="Give translators and AI shared guidance on tone and terminology."
            >
              <Card className="relative overflow-hidden border-border/80 shadow-xs">
                <CardContent className="pt-5">
                  <FieldGroup>
                    <TranslationContextField
                      id="project_translation_context"
                      value={form.translation_context ?? ''}
                      error={errors.translation_context}
                      disabled={!isAdmin}
                      onChange={(translation_context) =>
                        setSaveForm((f) => ({ ...(f ?? form), translation_context }))
                      }
                    />
                  </FieldGroup>
                </CardContent>
                <CardFooter className="justify-between border-t border-border/60 bg-muted/20">
                  {isAdmin ? (
                    <div className="flex w-full flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {isDirty ? (
                          <Badge
                            role="status"
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          >
                            Unsaved changes
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            All project settings are up to date.
                          </span>
                        )}
                      </div>
                      <Button onClick={saveSettings} disabled={!isDirty || updateMut.isPending} size="default">
                        {updateMut.isPending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
                        Save changes
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Only project admins can change these settings.</p>
                  )}
                </CardFooter>
              </Card>
            </PageSection>
          </div>

          <div id="settings-members-section" data-tour="members">
            <PageSection
              title="Members"
              description="Admins add people who have already signed in. Editors can work in the catalog but cannot change settings or membership."
            >
              <ProjectMembersSection projectId={projectId} isAdmin={isAdmin} />
            </PageSection>
          </div>

          {/* API Keys */}
          <div id="settings-api-keys-section">
            <PageSection
              title="API keys"
              description="A personal key for CLI sync. It identifies you in the activity log — do not share it. Generating a new key revokes your previous personal key for this project. Editors can revoke only keys they created."
            >
              <div data-tour="api-keys" className="flex flex-col gap-4">
                <Alert role="note" className="border-border/80 bg-muted/35 shadow-2xs">
                  <Terminal className="text-primary" />
                  <AlertTitle className="flex flex-wrap items-center justify-between gap-2 font-heading text-sm">
                    <span>CLI repository sync</span>
                    <Button size="sm" onClick={openGenerateKey}>
                      <Plus data-icon="inline-start" />
                      Generate key
                    </Button>
                  </AlertTitle>
                  <AlertDescription className="mt-1 flex flex-col gap-1 text-xs leading-relaxed">
                    <span>
                      Connect your repository: Run{' '}
                      <code
                        data-tour="loc-init"
                        className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono font-medium text-foreground wrap-anywhere"
                      >
                        {cliInitCommand()}
                      </code>
                      , then <code>loc pull</code> to download translations.
                    </span>
                    <span data-tour="loc-push">
                      <code>loc push</code> sends base-language strings that changed since the last push.
                    </span>
                    <span data-tour="push-limits">
                      A deleted key or a different base language rejects the push. Large pushes run in the background.
                    </span>
                  </AlertDescription>
                </Alert>

                {apiKeys.length > 0 ? (
                  <Card className="border-border/80 shadow-xs">
                    <CardContent className="flex flex-col gap-4 pt-5">
                      <DataTableToolbar
                        search={apiKeyFilter}
                        onSearchChange={setApiKeyFilter}
                        placeholder="Search keys…"
                      />
                      <DataTable table={apiKeyTable} />
                      <DataTablePagination table={apiKeyTable} />
                    </CardContent>
                  </Card>
                ) : (
                  <EmptyState
                    icon={<KeyRound className="size-6 text-muted-foreground" />}
                    title="No API keys yet"
                    description="Generate a personal key for the CLI. The secret is created automatically and shown once."
                    action={
                      <Button size="sm" onClick={openGenerateKey}>
                        <Plus data-icon="inline-start" />
                        Generate key
                      </Button>
                    }
                  />
                )}
              </div>
            </PageSection>
          </div>
        </div>
      </div>

      <Dialog
        open={showNewKey}
        onOpenChange={(o) => {
          if (!o) {
            setShowNewKey(false)
            setNewKeyName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" />
              Generate API key
            </DialogTitle>
            <DialogDescription>
              A secret is generated automatically and shown once. This key identifies you on the CLI
              — do not share it. Your previous personal key for this project will be revoked.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="key_name">Key name</FieldLabel>
              <Input
                id="key_name"
                placeholder={defaultKeyName}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
              <FieldDescription>
                A label for this key. The secret itself is generated for you.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNewKey(false)
                setNewKeyName('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => newKeyName.trim() && createKeyMut.mutate(newKeyName.trim())}
              disabled={!newKeyName.trim() || createKeyMut.isPending}
            >
              {createKeyMut.isPending && <Spinner data-icon="inline-start" />}
              Generate key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createdKey !== null} onOpenChange={(o) => !o && setCreatedKey(null)}>
        <DialogContent className="sm:max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <ShieldAlert className="size-5 text-amber-500" />
              API key generated
            </DialogTitle>
            <DialogDescription>
              Copy this key now. You will not be able to see it again.
            </DialogDescription>
          </DialogHeader>
          <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200">
            <TriangleAlert className="text-amber-600 dark:text-amber-400" />
            <AlertTitle>Store this key securely</AlertTitle>
            <AlertDescription>
              Use it with <code>loc init -k</code>. Anyone with this key can push to this project
              as you.
            </AlertDescription>
          </Alert>
          {createdKey ? (
            <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
              <CopyableSecretField
                value={createdKey.key}
                label="API key"
                onCopied={() => toast.success('Copied to clipboard')}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteKeyTarget !== null}
        onClose={() => setDeleteKeyTarget(null)}
        onConfirm={() => deleteKeyTarget && revokeKeyMut.mutate(deleteKeyTarget.id)}
        title={`Revoke "${deleteKeyTarget?.name}"?`}
        description="Any integrations using this key will stop working."
        confirmLabel="Revoke key"
        isLoading={revokeKeyMut.isPending}
      />
    </PageBody>
  )
}
