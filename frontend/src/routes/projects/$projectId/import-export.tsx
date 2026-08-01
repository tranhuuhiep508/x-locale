import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useState, useRef, lazy, Suspense } from 'react'
import { Download, Upload, FileText, FileSpreadsheet, ArrowUpDown } from 'lucide-react'
import { api } from '../../../lib/api/client'
import type { Project, ImportResult } from '../../../lib/api/types'
import { queryKeys } from '../../../lib/query-keys'
import {
  Button,
  Select,
  Label,
  FormField,
  Badge,
  Dialog,
  DialogFooter,
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
    <div className="p-6 max-w-2xl space-y-8">
      <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
        <ArrowUpDown className="h-5 w-5 text-brand-500" />
        Import / Export
      </h1>

      {/* Export */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Download className="h-4 w-4 text-brand-500" />
          Export
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <FormField>
            <Label>Format</Label>
            <Select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as 'json' | 'xlsx')}>
              <option value="json">JSON</option>
              <option value="xlsx">Excel (.xlsx)</option>
            </Select>
          </FormField>

          <FormField>
            <Label>Layout</Label>
            <Select
              value={exportLayout}
              onChange={(e) => setExportLayout(e.target.value as 'flat' | 'modular')}
            >
              <option value="flat">Flat</option>
              <option value="modular">Modular</option>
            </Select>
          </FormField>

          <FormField>
            <Label>Stage</Label>
            <Select
              value={exportStage}
              onChange={(e) => setExportStage(e.target.value as 'all' | 'public')}
            >
              <option value="all">All strings</option>
              <option value="public">Public only</option>
            </Select>
          </FormField>

          <FormField>
            <Label>Locale</Label>
            <Select
              value={exportLocale}
              onChange={(e) => setExportLocale(e.target.value)}
            >
              <option value="all">All locales</option>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <Button onClick={handleExport}>
          {exportFormat === 'xlsx' ? (
            <FileSpreadsheet className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          Download {exportFormat.toUpperCase()}
        </Button>
      </section>

      {/* Import */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Upload className="h-4 w-4 text-brand-500" />
          Import
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <FormField>
            <Label>Target locale</Label>
            <Select
              value={importLocale}
              onChange={(e) => setImportLocale(e.target.value)}
            >
              {locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField>
            <Label>Mode</Label>
            <Select
              value={dryRun ? 'dry' : 'apply'}
              onChange={(e) => setDryRun(e.target.value === 'dry')}
            >
              <option value="dry">Dry run (preview)</option>
              <option value="apply">Apply immediately</option>
            </Select>
          </FormField>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.xlsx"
          className="hidden"
          onChange={handleFileChange}
        />

        <Button
          variant="outline"
          onClick={() => fileRef.current?.click()}
          isLoading={importMut.isPending}
        >
          <Upload className="h-4 w-4" />
          {importMut.isPending ? 'Uploading…' : 'Choose file (JSON or XLSX)'}
        </Button>

        <p className="text-xs text-slate-400 mt-2">
          Accepted formats: .json, .xlsx — max 10 MB
        </p>
      </section>

      {/* Preview dialog */}
      <Dialog
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Import preview (dry run)"
        description="Review changes before applying."
        className="max-w-lg"
      >
        {previewResult?.diff && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-emerald-50 rounded-lg p-3">
                <p className="text-2xl font-bold text-emerald-700">
                  {previewResult.diff.create_count}
                </p>
                <p className="text-xs text-emerald-600">New strings</p>
              </div>
              <div className="bg-brand-50 rounded-lg p-3">
                <p className="text-2xl font-bold text-brand-700">
                  {previewResult.diff.update_count}
                </p>
                <p className="text-xs text-brand-600">Updated</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-2xl font-bold text-amber-700">
                  {previewResult.diff.orphan_count}
                </p>
                <p className="text-xs text-amber-600">Orphaned</p>
              </div>
            </div>

            {previewResult.diff.create.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1">New keys:</p>
                <div className="max-h-28 overflow-y-auto space-y-0.5">
                  {previewResult.diff.create.slice(0, 10).map((k) => (
                    <code key={k} className="block text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      + {k}
                    </code>
                  ))}
                  {previewResult.diff.create.length > 10 && (
                    <p className="text-xs text-slate-400">
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
          <Button onClick={confirmImport} isLoading={importMut.isPending}>
            Apply import
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
