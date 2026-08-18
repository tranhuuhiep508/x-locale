import { getRouteApi } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Trash2, Copy, Check } from 'lucide-react'
import { projectsApi } from '@/lib/api/projects'
import type { ApiKey, ApiKeyCreated } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import {
  languagesQuery,
  projectApiKeysQuery,
  projectQuery,
} from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/utils'
const routeApi = getRouteApi('/projects/$projectId/settings')


export function SettingsPage() {
  const { projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: project } = useQuery(projectQuery(projectId))

  const { data: languages = [] } = useQuery(languagesQuery())

  const { data: apiKeys = [] } = useQuery(projectApiKeysQuery(projectId))

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
  const [copied, setCopied] = useState(false)

  const createKeyMut = useMutation({
    mutationFn: (name: string) =>
      projectsApi.createApiKey(projectId, name),
    onSuccess: (key) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.apiKeys(projectId) })
      setCreatedKey(key)
      setShowNewKey(false)
      setNewKeyName('')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create key'),
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

  function copyKey() {
    if (!createdKey) return
    navigator.clipboard.writeText(createdKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!project) return null

  const targetLangs = languages.filter((l) => l.code !== form.base_language)
  const isDirty = saveForm !== null

  return (
    <div className="container flex flex-col gap-10 py-6">
      {/* Project settings */}
      <section>
        <h1 className="text-xl font-semibold text-foreground mb-5">Project settings</h1>

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
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">API Keys</h2>
            <p className="text-sm text-muted-foreground">
              Use API keys to authenticate CLI sync and integrations.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowNewKey(true)}>
            <Plus data-icon="inline-start" />
            New key
          </Button>
        </div>

        {apiKeys.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {k.key_prefix}…
                    </code>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(k.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {k.last_used_at ? formatDate(k.last_used_at) : '—'}
                  </TableCell>
                  <TableCell>
                    {k.revoked_at ? (
                      <Badge variant="destructive">Revoked</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!k.revoked_at && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteKeyTarget(k)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground py-4">No API keys yet.</p>
        )}
      </section>

      {/* Create key dialog */}
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
            <DialogTitle>Create API key</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="key_name">Key name</FieldLabel>
              <Input
                id="key_name"
                placeholder="CI/CD pipeline"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
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
              onClick={() => newKeyName && createKeyMut.mutate(newKeyName)}
              disabled={!newKeyName || createKeyMut.isPending}
            >
              {createKeyMut.isPending && <Spinner data-icon="inline-start" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show raw key (once only) */}
      <Dialog
        open={createdKey !== null}
        onOpenChange={(o) => !o && setCreatedKey(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>API key created</DialogTitle>
            <DialogDescription>
              Copy this key now — it won't be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 bg-muted border border-border rounded-md p-3">
            <code className="flex-1 text-xs font-mono text-foreground break-all">
              {createdKey?.key}
            </code>
            <Button variant="ghost" size="icon-sm" onClick={copyKey}>
              {copied ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
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
    </div>
  )
}
