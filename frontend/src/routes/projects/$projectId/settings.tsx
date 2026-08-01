import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Trash2, Eye, EyeOff, Copy, Check } from 'lucide-react'
import { api } from '../../../lib/api/client'
import type { Project, Language, ApiKey, ApiKeyCreated } from '../../../lib/api/types'
import { queryKeys } from '../../../lib/query-keys'
import {
  Button,
  Input,
  Label,
  FormField,
  FormError,
  Select,
  Dialog,
  DialogFooter,
  ConfirmDialog,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../../components/ui'
import { useToast } from '../../../store'
import { formatDate } from '../../../lib/utils'

export const Route = createFileRoute('/projects/$projectId/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { projectId } = Route.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: project } = useQuery<Project>({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
  })

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: queryKeys.languages(),
    queryFn: () => api.get<Language[]>('/languages'),
  })

  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
    queryKey: queryKeys.projectApiKeys(projectId),
    queryFn: () => api.get<ApiKey[]>(`/projects/${projectId}/api-keys`),
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
      api.patch<Project>(`/projects/${projectId}`, data),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.project(projectId), updated)
      qc.invalidateQueries({ queryKey: queryKeys.projects() })
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
      api.post<ApiKeyCreated>(`/projects/${projectId}/api-keys`, { name }),
    onSuccess: (key) => {
      qc.invalidateQueries({ queryKey: queryKeys.projectApiKeys(projectId) })
      setCreatedKey(key)
      setShowNewKey(false)
      setNewKeyName('')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create key'),
  })

  const revokeKeyMut = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/api-keys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectApiKeys(projectId) })
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
    <div className="p-6 max-w-2xl space-y-10">
      {/* Project settings */}
      <section>
        <h1 className="text-xl font-semibold text-slate-900 mb-5">Project settings</h1>

        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <FormField>
            <Label>Project name</Label>
            <Input
              value={form.name}
              onChange={(e) =>
                setSaveForm((f) => ({ ...(f ?? form), name: e.target.value }))
              }
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField>
              <Label>Base language</Label>
              <Select
                value={form.base_language}
                onChange={(e) =>
                  setSaveForm((f) => ({
                    ...(f ?? form),
                    base_language: e.target.value,
                    target_languages: (f ?? form).target_languages.filter(
                      (l) => l !== e.target.value,
                    ),
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
              <Label>Layout</Label>
              <Select
                value={form.layout}
                onChange={(e) =>
                  setSaveForm((f) => ({
                    ...(f ?? form),
                    layout: e.target.value as 'flat' | 'modular',
                  }))
                }
              >
                <option value="flat">Flat</option>
                <option value="modular">Modular</option>
              </Select>
            </FormField>
          </div>

          <FormField>
            <Label>Target languages</Label>
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

          <div className="flex justify-end">
            <Button
              onClick={() => updateMut.mutate(form)}
              isLoading={updateMut.isPending}
              disabled={!isDirty}
            >
              Save changes
            </Button>
          </div>
        </div>
      </section>

      {/* API Keys */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">API Keys</h2>
            <p className="text-sm text-slate-500">
              Use API keys to authenticate CLI sync and integrations.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowNewKey(true)}>
            <Plus className="h-4 w-4" />
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
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                      {k.key_prefix}…
                    </code>
                  </TableCell>
                  <TableCell className="text-slate-500 text-xs">
                    {formatDate(k.created_at)}
                  </TableCell>
                  <TableCell className="text-slate-500 text-xs">
                    {k.last_used_at ? formatDate(k.last_used_at) : '—'}
                  </TableCell>
                  <TableCell>
                    {k.revoked_at ? (
                      <Badge variant="destructive">Revoked</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!k.revoked_at && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-slate-400 hover:text-red-500"
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
          <p className="text-sm text-slate-400 py-4">No API keys yet.</p>
        )}
      </section>

      {/* Create key dialog */}
      <Dialog
        open={showNewKey}
        onClose={() => { setShowNewKey(false); setNewKeyName('') }}
        title="Create API key"
      >
        <FormField>
          <Label>Key name</Label>
          <Input
            placeholder="CI/CD pipeline"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowNewKey(false); setNewKeyName('') }}>
            Cancel
          </Button>
          <Button
            onClick={() => newKeyName && createKeyMut.mutate(newKeyName)}
            isLoading={createKeyMut.isPending}
            disabled={!newKeyName}
          >
            Create
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Show raw key (once only) */}
      <Dialog
        open={createdKey !== null}
        onClose={() => setCreatedKey(null)}
        title="API key created"
        description="Copy this key now — it won't be shown again."
      >
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md p-3">
          <code className="flex-1 text-xs font-mono text-slate-800 break-all">
            {createdKey?.key}
          </code>
          <Button variant="ghost" size="icon-sm" onClick={copyKey}>
            {copied ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => setCreatedKey(null)}>Done</Button>
        </DialogFooter>
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
