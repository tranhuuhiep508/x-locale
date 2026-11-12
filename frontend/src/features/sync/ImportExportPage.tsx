import { getRouteApi } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import {
  ArrowUpDown,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Upload,
} from 'lucide-react'
import { claimFinish, jobSuccessMessage, refreshProjectContent, rememberJob, useActiveJobId } from '@/lib/active-job'
import { isJobAccepted } from '@/lib/api/jobs'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, ProjectLayout } from '@/lib/api/types'
import { useJob } from '@/hooks/use-job'
import { JobProgress } from '@/components/job-progress'
import { importProgressLabel } from '@/lib/job-progress'
import { modulesQuery, projectQuery } from '@/lib/queries'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
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
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { MarkWell, PageBody, PageHeader } from '@/components/layout/PageHeader'
import { useToast } from '@/lib/toast'
import {
  DEMO_JSON_TEMPLATE,
  demoJsonFilename,
  demoJsonText,
} from '@/features/sync/import-templates'

const routeApi = getRouteApi('/projects/$projectRef/import-export')
const NONE_MODULE = '__none__'
const MAX_IMPORT_BYTES = 10 * 1024 * 1024

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
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const storedJobId = useActiveJobId(projectId, 'import')
  const trackedJobId = importJobId ?? storedJobId

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

  function showImportResult(res: ImportResult) {
    if (res.dry_run) {
      setPreviewResult(res)
      setShowPreview(true)
      return
    }
    toast.success(jobSuccessMessage('import', { created: res.created, updated: res.updated }))
    setPreviewResult(null)
    pendingFileRef.current = null
    refreshProjectContent(queryClient, projectId)
  }

  const importMut = useMutation({
    mutationFn: async ({ file, dry }: { file: File; dry: boolean }) => {
      const fd = new FormData()
      fd.append('file', file)
      return syncApi.importFile(projectId, fd, importParams(file, dry))
    },
    onSuccess: (res, { dry }) => {
      if (isJobAccepted(res)) {
        rememberJob({ jobId: res.job_id, projectId, kind: 'import', dryRun: dry })
        setImportJobId(res.job_id)
      } else showImportResult(res)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  })

  const importJob = useJob(trackedJobId, {
    onStopped: () => {
      setImportJobId(null)
      setPreviewResult(null)
      setShowPreview(false)
      pendingFileRef.current = null
    },
    onCompleted: (job) => {
      setImportJobId(null)
      const result = job.result as unknown as ImportResult
      const won = claimFinish(job.id)
      if (result.dry_run) {
        setPreviewResult(result)
        setShowPreview(true)
        return
      }
      setPreviewResult(null)
      pendingFileRef.current = null
      if (!won) return
      toast.success(jobSuccessMessage('import', job.result))
      refreshProjectContent(queryClient, projectId)
    },
    onFailed: (error) => {
      setImportJobId(null)
      if (!trackedJobId || !claimFinish(trackedJobId)) return
      toast.error(error.message)
    },
  })
  const importBusy = importMut.isPending || trackedJobId !== null

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

  function importFile(file: File | undefined) {
    if (!file || importBusy) return
    if (!/\.(json|xlsx)$/i.test(file.name)) {
      toast.error('Choose a JSON (.json) or Excel (.xlsx) file')
      return
    }
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error('File must be 10 MB or smaller')
      return
    }
    pendingFileRef.current = file
    importMut.mutate({ file, dry: dryRun })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    importFile(e.target.files?.[0])
    e.target.value = ''
  }

  function handleFileDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    importFile(e.dataTransfer.files[0])
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
    <PageBody
      data-tour-ready={project ? 'import' : undefined}
      className="mx-auto w-full max-w-6xl pb-16"
    >
      <PageHeader
        eyebrow="Project"
        title="Import / Export"
        description="Download snapshots of this catalog across draft/public stages, or import translations from JSON and Excel files."
        actions={
          project ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs uppercase">
                {project.base_language} → {project.target_languages.filter((l) => l !== project.base_language).length} targets
              </Badge>
              <Badge variant="secondary" className="capitalize">
                {project.layout} layout
              </Badge>
            </div>
          ) : null
        }
      />

      {/* Pipeline Stage Architecture Banner */}
      <Alert role="note" className="animate-stage-in sky-panel border-border/80" style={{ '--stagger': 1 } as React.CSSProperties}>
        <ArrowUpDown className="text-primary" />
        <AlertTitle className="font-heading text-sm">Draft working copy vs. published snapshots</AlertTitle>
        <AlertDescription className="text-xs">
          Imports always write to your working copy without auto-publishing. Exporting the{' '}
          <span className="font-medium text-foreground">Published snapshot</span> reads only verified public versions.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Export Card */}
        <Card
          style={{ '--stagger': 2 } as React.CSSProperties}
          className="animate-stage-in relative flex flex-col justify-between overflow-hidden shadow-xs"
        >
          <div
            className="animate-meridian-stream absolute inset-x-0 top-0 h-px"
            aria-hidden="true"
          />
          <CardHeader className="border-b border-border/50 bg-muted/15 pb-4">
            <CardTitle className="flex items-center gap-2.5">
              <MarkWell>
                <Download className="size-4" />
              </MarkWell>
              <span>Export Catalog</span>
            </CardTitle>
            <CardDescription>
              Download strings in JSON or Excel format configured for your pipeline.
            </CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                Stage: {exportStage}
              </Badge>
            </CardAction>
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
        <Card
          data-tour="import-lock"
          style={{ '--stagger': 3 } as React.CSSProperties}
          className="animate-stage-in relative flex flex-col justify-between overflow-hidden shadow-xs"
        >
          <div
            className="animate-meridian-stream absolute inset-x-0 top-0 h-px"
            aria-hidden="true"
          />
          <CardHeader className="border-b border-border/50 bg-muted/15 pb-4">
            <CardTitle className="flex items-center gap-2.5">
              <MarkWell>
                <Upload className="size-4" />
              </MarkWell>
              <span>Import Strings</span>
            </CardTitle>
            <CardDescription>
              Upload JSON or Excel files. Preview and review changes safely before applying.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {dryRun ? 'Dry run enabled' : 'Direct apply'}
              </Badge>
            </CardAction>
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

              <Field data-tour="import-conflicts">
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
                    Applied to JSON uploads. Excel uses module mappings in its hidden _meta sheet,
                    or sheet names for legacy workbooks without mappings.
                  </p>
                </Field>
              ) : null}
            </FieldGroup>

            <input
              ref={fileRef}
              type="file"
              accept=".json,.xlsx"
              className="hidden"
              disabled={importBusy}
              onChange={handleFileChange}
            />

            {/* Visual File Picker Zone */}
            <button
              type="button"
              data-tour="import-file"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              disabled={importBusy}
              className="group flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center cursor-pointer transition-all duration-200 hover:border-primary/50 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
            >
              <MarkWell className="mb-2.5 transition-transform duration-200 group-hover:-translate-y-0.5">
                <Upload aria-hidden="true" className="size-4" />
              </MarkWell>
              <span className="text-xs font-medium text-foreground">
                Click to browse or drop .json / .xlsx file here
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5">
                Maximum file size: 10 MB. Dotted keys are preserved.
              </span>
            </button>
            {trackedJobId ? (
              <JobProgress
                progress={importJob.data?.progress}
                error={importJob.isError ? importJob.error : undefined}
                paused={importJob.isPaused}
                label={importProgressLabel(importJob.data?.progress)}
              />
            ) : null}
          </CardContent>
          <CardFooter className="border-t border-border/50 bg-muted/20 pt-4">
            <Button
              variant="outline"
              data-tour="import-submit"
              onClick={() => fileRef.current?.click()}
              disabled={importBusy}
              className="w-full sm:w-auto"
            >
              {importBusy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              {importJobId ? 'Importing…' : importMut.isPending ? 'Uploading…' : 'Choose file (JSON or XLSX)'}
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Format Documentation & Template Card */}
      <Card
        data-tour="import-format"
        style={{ '--stagger': 4 } as React.CSSProperties}
        className="animate-stage-in shadow-xs"
      >
        <CardHeader className="border-b border-border/50 bg-muted/15 pb-4">
          <CardTitle className="flex items-center gap-2.5">
            <MarkWell>
              <FileCode2 className="size-4" />
            </MarkWell>
            <span>Import template & Schema</span>
          </CardTitle>
          <CardDescription>
            {isModularProject
              ? 'JSON keys are stored exactly as written. Pick a module when uploading JSON. Excel exports and examples store full module slugs in a hidden _meta sheet. Before renaming or copying a worksheet, unhide _meta and update or add its module_slug:<sheet name> entry. The entry value is the full module slug and must be unique per worksheet. Legacy workbooks without mappings use sheet names as module slugs.'
              : 'JSON keys are stored exactly as written. Excel uses one strings sheet.'}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px]">.json</Badge>
              <Badge variant="outline" className="font-mono text-[10px]">.xlsx</Badge>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-haze-950 p-4 font-mono text-xs text-haze-200 leading-relaxed dark:bg-black/60">
            {demoJsonText().trimEnd()}
          </pre>
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-border/75 bg-muted/20 p-4">
            <div className="flex flex-col gap-2">
              <span className="eyebrow text-[10px]">Starter templates</span>
              {isModularProject ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  CLI modular layout uses folders instead:{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    auth/{project?.base_language ?? 'vi'}.json
                  </code>
                  . Keys inside that file stay as-is; the folder name is the module.
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  One file per language (e.g.{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {demoJsonFilename(project?.base_language ?? 'vi')}
                  </code>
                  ). Choose the matching target locale when you import.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Demo keys: {Object.keys(DEMO_JSON_TEMPLATE).join(', ')}. Replace values with your copy
                before importing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
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
          </div>
        </CardContent>
      </Card>

      <ImportPreviewDialog
        open={showPreview}
        result={previewResult}
        pending={importBusy}
        onCancel={() => setShowPreview(false)}
        onApply={confirmImport}
      />
    </PageBody>
  )
}
