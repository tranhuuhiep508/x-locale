import { getRouteApi } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import { Download, Upload, FileText, FileSpreadsheet, ArrowUpDown } from 'lucide-react'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, ProjectLayout } from '@/lib/api/types'
import { projectQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/lib/toast'

const routeApi = getRouteApi('/projects/$projectId/import-export')

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}

export function ImportExportPage() {
  const { projectId } = routeApi.useParams()
  const toast = useToast()
  const queryClient = useQueryClient()

  const { data: project } = useQuery(projectQuery(projectId))

  const [exportFormat, setExportFormat] = useState<'json' | 'xlsx'>('json')
  const [exportLayout, setExportLayout] = useState<ProjectLayout | null>(null)
  const [exportStage, setExportStage] = useState<'all' | 'public'>('all')
  const [exportLocale, setExportLocale] = useState<string>('all')

  const fileRef = useRef<HTMLInputElement>(null)
  const pendingFileRef = useRef<File | null>(null)
  const [dryRun, setDryRun] = useState(true)
  const [importLocale, setImportLocale] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<ImportResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const layout = exportLayout ?? project?.layout ?? 'flat'
  const targetLocale = importLocale ?? project?.base_language ?? 'en'

  const importMut = useMutation({
    mutationFn: async ({
      file,
      locale,
      dry,
    }: {
      file: File
      locale: string
      dry: boolean
    }) => {
      const fd = new FormData()
      fd.append('file', file)
      return syncApi.importFile(projectId, fd, { locale, dry_run: String(dry) })
    },
    onSuccess: (res) => {
      if (res.dry_run) {
        setPreviewResult(res)
        setShowPreview(true)
        return
      }
      toast.success(`Import complete: ${res.created} created, ${res.updated} updated`)
      setPreviewResult(null)
      pendingFileRef.current = null
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  })

  const exportMut = useMutation({
    mutationFn: () =>
      syncApi.exportFile(projectId, {
        format: exportFormat,
        layout,
        stage: exportStage === 'all' ? 'draft' : 'public',
        locale: exportLocale === 'all' ? undefined : exportLocale,
      }),
    onSuccess: ({ blob, filename }) => {
      triggerDownload(blob, filename)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Export failed'),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    pendingFileRef.current = file
    importMut.mutate({ file, locale: targetLocale, dry: dryRun })
    e.target.value = ''
  }

  function confirmImport() {
    const file = pendingFileRef.current
    if (!file) {
      toast.error('Please select a file again to confirm import')
      setShowPreview(false)
      return
    }
    importMut.mutate({
      file,
      locale: targetLocale,
      dry: false,
    })
    setShowPreview(false)
  }

  const locales = project
    ? [project.base_language, ...project.target_languages]
    : []

  return (
    <div className="container flex flex-col gap-8 py-6">
      <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
        <ArrowUpDown className="h-5 w-5 text-primary" />
        Import / Export
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            Export
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="export_format">Format</FieldLabel>
              <Select
                value={exportFormat}
                onValueChange={(v) => setExportFormat(v as 'json' | 'xlsx')}
              >
                <SelectTrigger id="export_format" className="w-full">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="export_layout">Layout</FieldLabel>
              <Select
                value={layout}
                onValueChange={(v) => setExportLayout(v as ProjectLayout)}
              >
                <SelectTrigger id="export_layout" className="w-full">
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

            <Field>
              <FieldLabel htmlFor="export_stage">Stage</FieldLabel>
              <Select
                value={exportStage}
                onValueChange={(v) => setExportStage(v as 'all' | 'public')}
              >
                <SelectTrigger id="export_stage" className="w-full">
                  <SelectValue placeholder="Stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All strings</SelectItem>
                    <SelectItem value="public">Public only</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="export_locale">Locale</FieldLabel>
              <Select value={exportLocale} onValueChange={setExportLocale}>
                <SelectTrigger id="export_locale" className="w-full">
                  <SelectValue placeholder="Locale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All locales</SelectItem>
                    {locales.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div>
            <Button onClick={() => exportMut.mutate()} disabled={exportMut.isPending}>
              {exportMut.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : exportFormat === 'xlsx' ? (
                <FileSpreadsheet data-icon="inline-start" />
              ) : (
                <FileText data-icon="inline-start" />
              )}
              {exportMut.isPending ? 'Preparing…' : `Download ${exportFormat.toUpperCase()}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            Import
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="import_locale">Target locale</FieldLabel>
              <Select value={targetLocale} onValueChange={setImportLocale}>
                <SelectTrigger id="import_locale" className="w-full">
                  <SelectValue placeholder="Target locale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {locales.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="import_mode">Mode</FieldLabel>
              <Select
                value={dryRun ? 'dry' : 'apply'}
                onValueChange={(v) => setDryRun(v === 'dry')}
              >
                <SelectTrigger id="import_mode" className="w-full">
                  <SelectValue placeholder="Mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="dry">Dry run (preview)</SelectItem>
                    <SelectItem value="apply">Apply immediately</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".json,.xlsx"
            className="hidden"
            onChange={handleFileChange}
          />

          <div>
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={importMut.isPending}
            >
              {importMut.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              {importMut.isPending ? 'Uploading…' : 'Choose file (JSON or XLSX)'}
            </Button>

            <p className="text-xs text-muted-foreground mt-2">
              Accepted formats: .json, .xlsx — max 10 MB. A single-locale JSON file is applied to
              the target locale; exported multi-locale files import every locale they contain.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showPreview} onOpenChange={(o) => !o && setShowPreview(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import preview (dry run)</DialogTitle>
            <DialogDescription>Review changes before applying.</DialogDescription>
          </DialogHeader>
          {previewResult?.diff && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-2xl font-bold text-foreground">
                    {previewResult.diff.create_count}
                  </p>
                  <p className="text-xs text-muted-foreground">New strings</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-2xl font-bold text-foreground">
                    {previewResult.diff.update_count}
                  </p>
                  <p className="text-xs text-muted-foreground">Updated</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-2xl font-bold text-foreground">
                    {previewResult.diff.orphan_count}
                  </p>
                  <p className="text-xs text-muted-foreground">Orphaned</p>
                </div>
              </div>

              {previewResult.diff.create.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">New keys:</p>
                  <div className="max-h-28 overflow-y-auto flex flex-col gap-0.5">
                    {previewResult.diff.create.slice(0, 10).map((k) => (
                      <code
                        key={k}
                        className="block text-xs text-foreground bg-muted px-2 py-0.5 rounded"
                      >
                        + {k}
                      </code>
                    ))}
                    {previewResult.diff.create.length > 10 && (
                      <p className="text-xs text-muted-foreground">
                        and {previewResult.diff.create.length - 10} more…
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Cancel
            </Button>
            <Button onClick={confirmImport} disabled={importMut.isPending}>
              {importMut.isPending && <Spinner data-icon="inline-start" />}
              Apply import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
