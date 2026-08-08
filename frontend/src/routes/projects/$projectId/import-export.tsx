import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import { Download, Upload, FileText, FileSpreadsheet, ArrowUpDown } from 'lucide-react'
import { api } from '../../../lib/api/client'
import type { Project, ImportResult } from '../../../lib/api/types'
import { queryKeys } from '../../../lib/query-keys'
import {
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from '../../../components/ui'
import { useToast } from '../../../store'

export const Route = createFileRoute('/projects/$projectId/import-export')({
  component: ImportExportPage,
})

function ImportExportPage() {
  const { projectId } = Route.useParams()
  const toast = useToast()

  const { data: project } = useQuery<Project>({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
  })

  // Export state
  const [exportFormat, setExportFormat] = useState<'json' | 'xlsx'>('json')
  const [exportLayout, setExportLayout] = useState<'flat' | 'modular'>(
    project?.layout ?? 'flat',
  )
  const [exportStage, setExportStage] = useState<'all' | 'public'>('all')
  const [exportLocale, setExportLocale] = useState<string>('all')

  // Import state
  const fileRef = useRef<HTMLInputElement>(null)
  const [dryRun, setDryRun] = useState(true)
  const [importLocale, setImportLocale] = useState(project?.base_language ?? 'en')
  const [previewResult, setPreviewResult] = useState<ImportResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)

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
      return api.upload<ImportResult>(
        `/projects/${projectId}/import`,
        fd,
        { locale, dry_run: String(dry) },
      )
    },
    onSuccess: (res) => {
      if (res.dry_run) {
        setPreviewResult(res)
        setShowPreview(true)
      } else {
        toast.success(`Import complete: ${res.created} created, ${res.updated} updated`)
        setPreviewResult(null)
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  })

  function handleExport() {
    const params = new URLSearchParams({
      format: exportFormat,
      layout: exportLayout,
      stage: exportStage,
    })
    if (exportLocale !== 'all') params.set('locale', exportLocale)
    window.open(`/api/projects/${projectId}/export?${params}`, '_blank')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    importMut.mutate({ file, locale: importLocale, dry: dryRun })
    // Reset input for re-upload
    e.target.value = ''
  }

  function confirmImport() {
    if (!fileRef.current?.files?.[0]) {
      toast.error('Please select a file again to confirm import')
      setShowPreview(false)
      return
    }
    importMut.mutate({
      file: fileRef.current.files[0],
      locale: importLocale,
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

      {/* Export */}
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
                value={exportLayout}
                onValueChange={(v) => setExportLayout(v as 'flat' | 'modular')}
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
            <Button onClick={handleExport}>
              {exportFormat === 'xlsx' ? (
                <FileSpreadsheet data-icon="inline-start" />
              ) : (
                <FileText data-icon="inline-start" />
              )}
              Download {exportFormat.toUpperCase()}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Import */}
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
              <Select value={importLocale} onValueChange={setImportLocale}>
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
              Accepted formats: .json, .xlsx — max 10 MB
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Preview dialog */}
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
