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
import { Plus, TriangleAlert } from 'lucide-react'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { CopyableSecretField } from '@/components/copyable-secret-field'
import { apiKeyColumns } from '@/features/settings/api-keys-columns'
import { projectsApi } from '@/lib/api/projects'
import type { ApiKey, ApiKeyCreated } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import {
  languagesQuery,
  meQuery,
  projectApiKeysQuery,
  projectQuery,
} from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PageBody, PageHeader } from '@/components/layout/PageHeader'
import { useToast } from '@/lib/toast'
const routeApi = getRouteApi('/projects/$projectId/settings')


export function SettingsPage() {
  const { projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: project } = useQuery(projectQuery(projectId))
  const { data: me } = useQuery(meQuery())

  const { data: languages = [] } = useQuery(languagesQuery())
  const defaultKeyName = me?.email || 'Default'

  const { data: apiKeys = [] } = useQuery(projectApiKeysQuery(projectId))
  const apiKeyData = useMemo(() => apiKeys, [apiKeys])
  const [apiKeyFilter, setApiKeyFilter] = useState('')
  const [apiKeyPagination, setApiKeyPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })

  const [saveForm, setSaveForm] = useState<{
    name: string
    base_language: string
    target_languages: string[]
    layout: 'flat' | 'modular'
  } | null>(null)

  const form = saveForm ?? {
    name: project?.name ?? '',
    base_language: project?.base_language ?? 'en',
    target_languages: project?.target_languages ?? [],
    layout: project?.layout ?? 'flat',
  }

  const updateMut = useMutation({
    mutationFn: (data: typeof form) =>
      projectsApi.update(projectId, data),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.projects.detail(projectId), updated)
      qc.invalidateQueries({ queryKey: queryKeys.projects.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
      toast.success('Settings saved')
      setSaveForm(null)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save'),
  })

  const [showNewKey, setShowNewKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)
  const [deleteKeyTarget, setDeleteKeyTarget] = useState<ApiKey | null>(null)

  function openGenerateKey() {
    setNewKeyName(defaultKeyName)
    setShowNewKey(true)
  }

  const createKeyMut = useMutation({
    mutationFn: (name: string) =>
      projectsApi.createApiKey(projectId, name),
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

  function toggleTargetLang(code: string) {
    setSaveForm((f) => {
      const base = f ?? form
      return {
        ...base,
        target_languages: base.target_languages.includes(code)
          ? base.target_languages.filter((l) => l !== code)
          : [...base.target_languages, code],
      }
    })
  }

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
    },
  })

  if (!project) return null

  const targetLangs = languages.filter((l) => l.code !== form.base_language)
  const isDirty = saveForm !== null

  return (
    <PageBody className="gap-10">
      <section className="flex flex-col gap-5">
        <PageHeader
          eyebrow="Project"
          title="Settings"
          description="Name, languages, and layout for this catalog."
        />

        <Card>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project_name">Project name</FieldLabel>
                <Input
                  id="project_name"
                  value={form.name}
                  onChange={(e) =>
                    setSaveForm((f) => ({ ...(f ?? form), name: e.target.value }))
                  }
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="base_language">Base language</FieldLabel>
                  <Select
                    value={form.base_language}
                    onValueChange={(v) =>
                      setSaveForm((f) => ({
                        ...(f ?? form),
                        base_language: v,
                        target_languages: (f ?? form).target_languages.filter(
                          (l) => l !== v,
                        ),
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
              </div>

              <Field>
                <FieldLabel>Target languages</FieldLabel>
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

              <div className="flex justify-end">
                <Button
                  onClick={() => updateMut.mutate(form)}
                  disabled={!isDirty || updateMut.isPending}
                >
                  {updateMut.isPending && <Spinner data-icon="inline-start" />}
                  Save changes
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      </section>

      {/* API Keys */}
      <section className="flex flex-col gap-5">
        <PageHeader
          eyebrow="CLI"
          title="API keys"
          titleAs="h2"
          description="A personal key for CLI sync. It identifies you in the activity log — do not share it. Generating a new key revokes your previous personal key for this project."
          actions={
            <Button size="sm" onClick={openGenerateKey}>
              <Plus data-icon="inline-start" />
              Generate key
            </Button>
          }
        />

        {apiKeys.length > 0 ? (
          <div className="flex flex-col gap-4">
            <DataTableToolbar
              search={apiKeyFilter}
              onSearchChange={setApiKeyFilter}
              placeholder="Search keys…"
            />
            <DataTable table={apiKeyTable} />
            <DataTablePagination table={apiKeyTable} />
          </div>
        ) : (
          <EmptyState
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
      </section>

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
            <DialogTitle>Generate API key</DialogTitle>
            <DialogDescription>
              A secret is generated automatically and shown once. This key identifies you on the CLI — do not share it.
              Your previous personal key for this project will be revoked.
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

      <Dialog
        open={createdKey !== null}
        onOpenChange={(o) => !o && setCreatedKey(null)}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>API key generated</DialogTitle>
            <DialogDescription>
              Copy this key now. You will not be able to see it again.
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <TriangleAlert />
            <AlertTitle>Store this key securely</AlertTitle>
            <AlertDescription>
              Use it with <code>locale init -k</code>. Anyone with this key can push to this project as you.
            </AlertDescription>
          </Alert>
          {createdKey ? (
            <CopyableSecretField
              value={createdKey.key}
              label="API key"
              onCopied={() => toast.success('Copied to clipboard')}
            />
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
