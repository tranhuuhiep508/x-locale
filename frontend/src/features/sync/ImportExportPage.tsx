import { getRouteApi } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import {
  Download,
  FileSpreadsheet,
  FileText,
  Upload,
  ArrowUpDown,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileCode,
} from 'lucide-react'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, ProjectLayout } from '@/lib/api/types'
import { modulesQuery, projectQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { ImportPreviewDialog } from '@/features/sync/ImportPreviewDialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { PageBody, PageHeader } from '@/components/layout/PageHeader'
import { useToast } from '@/lib/toast'
import {
  DEMO_JSON_TEMPLATE,
  demoJsonFilename,
  demoJsonText,
} from '@/features/sync/import-templates'

const routeApi = getRouteApi('/projects/$projectRef/import-export')
const NONE_MODULE = '__none__'

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

function isExcelFile(file: File | null) {
  return Boolean(file && /\.xlsx$/i.test(file.name))
}

export function ImportExportPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const toast = useToast()
  const queryClient = useQueryClient()

  const { data: project } = useQuery(projectQuery(projectId))
  const isModularProject = project?.layout === 'modular'
  const { data: modules = [] } = useQuery({
    ...modulesQuery(projectId),
    enabled: isModularProject,
  })

  const [exportFormat, setExportFormat] = useState<'json' | 'xlsx'>('json')
  const [exportLayout, setExportLayout] = useState<ProjectLayout | null>(null)
  const [exportStage, setExportStage] = useState<'all' | 'public'>('all')
  const [exportLocale, setExportLocale] = useState<string>('all')

  const fileRef = useRef<HTMLInputElement>(null)
  const pendingFileRef = useRef<File | null>(null)
  const [dryRun, setDryRun] = useState(true)
  const [importLocale, setImportLocale] = useState<string | null>(null)
  const [importModuleId, setImportModuleId] = useState('')
  const [previewResult, setPreviewResult] = useState<ImportResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const layout = exportLayout ?? project?.layout ?? 'flat'
  const targetLocale = importLocale ?? project?.base_language ?? 'en'

  function importParams(file: File, dry: boolean) {
    const params: { locale: string; dry_run: string; module_id?: string } = {
      locale: targetLocale,
      dry_run: String(dry),
    }
    if (isModularProject && !isExcelFile(file) && importModuleId) {
      params.module_id = importModuleId
    }
    return params
  }

  const importMut = useMutation({
    mutationFn: async ({ file, dry }: { file: File; dry: boolean }) => {
      const fd = new FormData()
      fd.append('file', file)
      return syncApi.importFile(projectId, fd, importParams(file, dry))
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.modules(projectId) })
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

  const templateMut = useMutation({
    mutationFn: (format: 'json' | 'xlsx') => {
      if (format === 'json') {
        const blob = new Blob([demoJsonText()], { type: 'application/json' })
        return Promise.resolve({
          blob,
          filename: demoJsonFilename(project?.base_language ?? 'vi'),
        })
      }
      return syncApi.importTemplate(projectId, 'xlsx')
    },
    onSuccess: ({ blob, filename }) => {
      triggerDownload(blob, filename)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not download template'),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    pendingFileRef.current = file
    importMut.mutate({ file, dry: dryRun })
    e.target.value = ''
  }

  function confirmImport() {
    const file = pendingFileRef.current
    if (!file) {
      toast.error('Please select a file again to confirm import')
      setShowPreview(false)
      return
    }
    importMut.mutate({ file, dry: false })
    setShowPreview(false)
  }

  const locales = project ? [project.base_language, ...project.target_languages] : []

  return (
    <PageBody className="mx-auto w-full max-w-6xl pb-16">
      <PageHeader
        eyebrow="Project"
        title="Import / Export"
        description="Download snapshots of this catalog across draft/public stages, or import translations from JSON and Excel files."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Export Card */}
        <Card className="shadow-xs flex flex-col justify-between">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Download className="size-4.5 text-primary" />
                Export Catalog
              </CardTitle>
              <Badge variant="outline" className="font-mono text-[10px]">
                Stage: {exportStage}
              </Badge>
            </div>
            <CardDescription>
              Download strings in JSON or Excel format configured for your pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-5 pt-5">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="export_format">Format</FieldLabel>
                <Select
                  value={exportFormat}
                  onValueChange={(v) => setExportFormat(v as 'json' | 'xlsx')}
                >
                  <SelectTrigger id="export_format" className="w-full h-9">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="json">JSON format</SelectItem>
                      <SelectItem value="xlsx">Excel workbook (.xlsx)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="export_layout">Layout</FieldLabel>
                <Select value={layout} onValueChange={(v) => setExportLayout(v as ProjectLayout)}>
                  <SelectTrigger id="export_layout" className="w-full h-9">
                    <SelectValue placeholder="Layout" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="flat">Flat (single file)</SelectItem>
                      <SelectItem value="modular">Modular (per-module)</SelectItem>
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
                  <SelectTrigger id="export_stage" className="w-full h-9">
                    <SelectValue placeholder="Stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Working copy (all strings)</SelectItem>
                      <SelectItem value="public">Published snapshot only</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="export_locale">Locale</FieldLabel>
                <Select value={exportLocale} onValueChange={setExportLocale}>
                  <SelectTrigger id="export_locale" className="w-full h-9">
                    <SelectValue placeholder="Locale" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All locales</SelectItem>
                      {locales.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="border-t border-border/50 bg-muted/20 pt-4">
            <Button
              onClick={() => exportMut.mutate()}
              disabled={exportMut.isPending}
              className="w-full sm:w-auto shadow-xs"
            >
              {exportMut.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : exportFormat === 'xlsx' ? (
                <FileSpreadsheet data-icon="inline-start" />
              ) : (
                <FileText data-icon="inline-start" />
              )}
              {exportMut.isPending ? 'Preparing…' : `Download ${exportFormat.toUpperCase()}`}
            </Button>
          </CardFooter>
        </Card>

        {/* Import Card */}
        <Card className="shadow-xs flex flex-col justify-between">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Upload className="size-4.5 text-primary" />
                Import Strings
              </CardTitle>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {dryRun ? 'Dry run enabled' : 'Direct apply'}
              </Badge>
            </div>
            <CardDescription>
              Upload JSON or Excel files. Preview and review changes safely before applying.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-5 pt-5">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="import_locale">Target locale</FieldLabel>
                <Select value={targetLocale} onValueChange={setImportLocale}>
                  <SelectTrigger id="import_locale" className="w-full h-9">
                    <SelectValue placeholder="Target locale" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {locales.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l.toUpperCase()}
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
                  <SelectTrigger id="import_mode" className="w-full h-9">
                    <SelectValue placeholder="Mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="dry">Dry run (preview changes)</SelectItem>
                      <SelectItem value="apply">Apply immediately</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              {isModularProject ? (
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="import_module">Module (JSON only)</FieldLabel>
                  <Select
                    value={importModuleId || NONE_MODULE}
                    onValueChange={(v) => setImportModuleId(v === NONE_MODULE ? '' : v)}
                  >
                    <SelectTrigger id="import_module" className="w-full h-9">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={NONE_MODULE}>Unassigned</SelectItem>
                        {modules.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name} ({m.slug})
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Applied to JSON uploads. Excel ignores this and uses sheet names as module slugs.
                  </p>
                </Field>
              ) : null}
            </FieldGroup>

            <input
              ref={fileRef}
              type="file"
              accept=".json,.xlsx"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Visual File Picker Zone */}
            <div
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <Upload className="size-6 text-muted-foreground mb-2" />
              <p className="text-xs font-medium text-foreground">
                Click to browse or drop .json / .xlsx file here
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Maximum file size: 10 MB. Dotted keys are preserved.
              </p>
            </div>
          </CardContent>
          <CardFooter className="border-t border-border/50 bg-muted/20 pt-4">
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={importMut.isPending}
              className="w-full sm:w-auto"
            >
              {importMut.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              {importMut.isPending ? 'Uploading…' : 'Choose file (JSON or XLSX)'}
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Format Documentation & Template Card */}
      <Card className="shadow-xs">
        <CardHeader className="border-b border-border/50 pb-4">
          <p className="eyebrow">Format</p>
          <CardTitle>Import template & Schema</CardTitle>
          <CardDescription>
            {isModularProject
              ? 'JSON keys are stored exactly as written. Pick a module when uploading JSON. For Excel, each sheet name is the module slug.'
              : 'JSON keys are stored exactly as written. Excel uses one strings sheet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-5">
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-haze-950 p-4 font-mono text-xs text-haze-200 leading-relaxed dark:bg-black/60">
            {demoJsonText().trimEnd()}
          </pre>
          {isModularProject ? (
            <p className="text-xs text-muted-foreground">
              CLI modular layout uses folders instead:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                auth/{project?.base_language ?? 'vi'}.json
              </code>
              . Keys inside that file stay as-is; the folder name is the module.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              One file per language (e.g.{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                {demoJsonFilename(project?.base_language ?? 'vi')}
              </code>
              ). Choose the matching target locale when you import.
            </p>
          )}
          <div className="flex flex-wrap gap-2.5 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => templateMut.mutate('json')}
              disabled={templateMut.isPending}
            >
              {templateMut.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              JSON example
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => templateMut.mutate('xlsx')}
              disabled={templateMut.isPending}
            >
              {templateMut.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileSpreadsheet data-icon="inline-start" />
              )}
              Excel example
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Demo keys: {Object.keys(DEMO_JSON_TEMPLATE).join(', ')}. Replace values with your copy
            before importing.
          </p>
        </CardContent>
      </Card>

      <ImportPreviewDialog
        open={showPreview}
        result={previewResult}
        pending={importMut.isPending}
        onCancel={() => setShowPreview(false)}
        onApply={confirmImport}
      />
    </PageBody>
  )
}
