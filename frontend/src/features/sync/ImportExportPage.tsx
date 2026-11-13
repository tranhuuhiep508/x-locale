import { getRouteApi } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  Upload,
  Zap,
} from 'lucide-react'
import {
  claimFinish,
  jobSuccessMessage,
  refreshProjectContent,
  rememberJob,
  useActiveJobId,
} from '@/lib/active-job'
import { isJobAccepted } from '@/lib/api/jobs'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, Module, ProjectLayout } from '@/lib/api/types'
import { useJob } from '@/hooks/use-job'
import { JobProgress } from '@/components/job-progress'
import { importProgressLabel } from '@/lib/job-progress'
import { languagesQuery, modulesQuery, projectQuery } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MarkWell, PageHeader, PageStickyHeader } from '@/components/layout/PageHeader'
import { useToast } from '@/lib/toast'
import {
  DEMO_JSON_TEMPLATE,
  demoJsonFilename,
  demoJsonText,
} from '@/features/sync/import-templates'

const routeApi = getRouteApi('/projects/$projectRef/import-export')
const NONE_MODULE = '__none__'
const MAX_IMPORT_BYTES = 10 * 1024 * 1024

type SchemaTab = 'json' | 'xlsx'

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

function describeExportBundle({
  format,
  layout,
  stage,
  locale,
}: {
  format: 'json' | 'xlsx'
  layout: ProjectLayout
  stage: 'all' | 'public'
  locale: string
}) {
  const container =
    format === 'xlsx' ? 'Excel workbook (.xlsx)' : 'Single JSON bundle (.json)'

  const structure =
    format === 'xlsx'
      ? layout === 'modular'
        ? 'One worksheet per module plus hidden _meta slug mapping.'
        : 'Single strings worksheet with keys and translation columns.'
      : layout === 'modular'
        ? 'JSON object grouped by module slug and locale.'
        : 'Flat key dictionary grouped by locale.'

  const stageDetail =
    stage === 'public'
      ? 'Reads frozen published snapshots only; missing targets export empty.'
      : 'Reads working copy (draft & live edits); omits pending deletes.'

  const scope = locale === 'all' ? 'All locales' : `${locale.toUpperCase()} only`

  return { container, structure, stageDetail, scope }
}

function ExportManifestPanel({
  format,
  layout,
  stage,
  locale,
}: {
  format: 'json' | 'xlsx'
  layout: ProjectLayout
  stage: 'all' | 'public'
  locale: string
}) {
  const manifest = describeExportBundle({ format, layout, stage, locale })
  const FormatIcon = format === 'xlsx' ? FileSpreadsheet : FileCode2

  return (
    <div className="rounded-xl border border-border/80 bg-muted/25 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FormatIcon className="size-3.5 text-primary" aria-hidden="true" />
          <span>{manifest.container}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-2xs">
          <Badge variant="outline" className="bg-background font-mono text-3xs">
            {layout}
          </Badge>
          <Badge variant="outline" className="bg-background font-mono text-3xs">
            {manifest.scope}
          </Badge>
          <Badge
            variant="outline"
            className={`font-mono text-3xs ${
              stage === 'public'
                ? 'border-primary/35 bg-primary/10 text-primary'
                : 'bg-background text-muted-foreground'
            }`}
          >
            {stage === 'public' ? 'published' : 'working'}
          </Badge>
        </div>
      </div>
      <dl className="mt-2.5 grid gap-1.5 border-t border-border/60 pt-2.5 text-xs">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
          <dt className="shrink-0 font-mono text-2xs text-muted-foreground">Shape:</dt>
          <dd className="text-foreground/90">{manifest.structure}</dd>
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
          <dt className="shrink-0 font-mono text-2xs text-muted-foreground">Source:</dt>
          <dd className="text-muted-foreground">{manifest.stageDetail}</dd>
        </div>
      </dl>
    </div>
  )
}

function ExcelWorksheetPreview({
  baseLanguage,
  isModularProject,
}: {
  baseLanguage: string
  isModularProject: boolean
}) {
  const targetSample = baseLanguage === 'en' ? 'vi' : 'en'
  const sampleRows = [
    { key: 'common.save', base: 'Lưu', target: 'Save' },
    { key: 'hello', base: 'Xin chào', target: 'Hello' },
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-border/75 bg-background">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-3.5 py-2 text-2xs">
        <span className="font-mono font-medium text-foreground">
          {isModularProject ? 'Worksheet: common (+ _meta)' : 'Worksheet: strings'}
        </span>
        <span className="font-mono text-muted-foreground">.xlsx columns</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20 text-2xs text-muted-foreground">
              <th className="px-3.5 py-2 font-medium">key</th>
              <th className="px-3.5 py-2 font-medium">{baseLanguage}</th>
              <th className="px-3.5 py-2 font-medium">{targetSample}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sampleRows.map((row) => (
              <tr key={row.key}>
                <td className="px-3.5 py-2 font-medium text-foreground" translate="no">
                  {row.key}
                </td>
                <td className="px-3.5 py-2 font-sans text-muted-foreground">{row.base}</td>
                <td className="px-3.5 py-2 font-sans text-muted-foreground">{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SchemaContractSection({
  baseLanguage,
  isModularProject,
  templatePending,
  onDownloadTemplate,
}: {
  baseLanguage: string
  isModularProject: boolean
  templatePending: boolean
  onDownloadTemplate: (format: 'json' | 'xlsx') => void
}) {
  const [schemaTab, setSchemaTab] = useState<SchemaTab>('json')
  const [copiedJson, setCopiedJson] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    }
  }, [])

  async function copySampleJson() {
    try {
      await navigator.clipboard.writeText(demoJsonText())
      setCopiedJson(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopiedJson(false), 1500)
    } catch {
      // Ignore clipboard denials cleanly; specimen remains visible.
    }
  }

  return (
    <section
      data-tour="import-format"
      style={{ '--stagger': 4 } as React.CSSProperties}
      className="animate-stage-in overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs"
      aria-labelledby="file-contract-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/15 px-5 py-4">
        <div className="flex items-center gap-3">
          <MarkWell>
            <FileCode2 className="size-4" aria-hidden="true" />
          </MarkWell>
          <div>
            <h2 id="file-contract-heading" className="font-heading text-base font-semibold">
              File contract & starter templates
            </h2>
            <p className="text-xs text-muted-foreground">
              {isModularProject
                ? 'JSON keys stay flat inside a single module; multi-sheet Excel workbooks import across modules.'
                : 'JSON keys are stored verbatim as written; Excel workbooks read from one strings sheet.'}
            </p>
          </div>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={schemaTab}
          aria-label="Template format preview"
          onValueChange={(next) => {
            if (next) setSchemaTab(next as SchemaTab)
          }}
        >
          <ToggleGroupItem value="json" className="font-mono text-xs">
            .json
          </ToggleGroupItem>
          <ToggleGroupItem value="xlsx" className="font-mono text-xs">
            .xlsx
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {schemaTab === 'json' ? (
            <div className="overflow-hidden rounded-xl border border-border/70 bg-haze-950 text-haze-200">
              <div className="flex items-center justify-between border-b border-haze-800/80 px-4 py-2 text-2xs text-haze-400">
                <span className="font-mono">{demoJsonFilename(baseLanguage)} · UTF-8</span>
                <button
                  type="button"
                  onClick={copySampleJson}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-2xs text-haze-300 transition-colors hover:bg-haze-800/70 hover:text-sun focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {copiedJson ? (
                    <Check className="size-3 text-primary" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3" aria-hidden="true" />
                  )}
                  {copiedJson ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
                {demoJsonText().trimEnd()}
              </pre>
            </div>
          ) : (
            <ExcelWorksheetPreview
              baseLanguage={baseLanguage}
              isModularProject={isModularProject}
            />
          )}

          {isModularProject ? (
            <details className="rounded-lg border border-border/75 bg-muted/20 px-3.5 py-2.5 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground select-none">
                Excel worksheet mapping details (_meta)
              </summary>
              <p className="mt-2 leading-relaxed">
                Excel exports and starter templates store full module slugs inside a hidden{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs text-foreground">
                  _meta
                </code>{' '}
                sheet. Before renaming or copying a worksheet, unhide{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs text-foreground">
                  _meta
                </code>{' '}
                and update or add its{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs text-foreground">
                  module_slug:&lt;sheet name&gt;
                </code>{' '}
                entry (unique per worksheet). Legacy workbooks without mappings use sheet names as
                module slugs.
              </p>
            </details>
          ) : null}
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-xl border border-border/75 bg-muted/20 p-4">
          <div className="flex flex-col gap-2">
            <span className="eyebrow text-3xs">Starter templates</span>
            {isModularProject ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                CLI modular layout uses folders instead:{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
                  auth/{baseLanguage}.json
                </code>
                . Keys inside that file stay as-is; the folder name is the module.
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                One file per language (e.g.{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
                  {demoJsonFilename(baseLanguage)}
                </code>
                ). Choose the matching target locale when you import.
              </p>
            )}
            <p className="text-2xs text-muted-foreground">
              Demo keys: {Object.keys(DEMO_JSON_TEMPLATE).join(', ')}. Replace values with your
              copy before importing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownloadTemplate('json')}
              disabled={templatePending}
            >
              {templatePending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              JSON example
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownloadTemplate('xlsx')}
              disabled={templatePending}
            >
              {templatePending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileSpreadsheet data-icon="inline-start" />
              )}
              Excel example
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function selectedModuleLabel(modules: Module[], moduleId: string) {
  if (!moduleId) return 'Unassigned'
  const match = modules.find((item) => item.id === moduleId)
  return match ? match.name : 'Unassigned'
}

export function ImportExportPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const toast = useToast()
  const queryClient = useQueryClient()

  const { data: project } = useQuery(projectQuery(projectId))
  const { data: languages = [] } = useQuery(languagesQuery())
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
  const [isDragging, setIsDragging] = useState(false)
  const storedJobId = useActiveJobId(projectId, 'import')
  const trackedJobId = importJobId ?? storedJobId

  const layout = exportLayout ?? project?.layout ?? 'flat'
  const targetLocale = importLocale ?? project?.base_language ?? 'en'

  const languageNames = useMemo(
    () => new Map(languages.map((lang) => [lang.code, lang.name])),
    [languages]
  )

  function formatLocaleDisplay(code: string) {
    const name = languageNames.get(code)
    return name ? `${code.toUpperCase()} — ${name}` : code.toUpperCase()
  }

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
    setIsDragging(false)
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
  const targetCount = project
    ? project.target_languages.filter((l) => l !== project.base_language).length
    : 0
  const moduleSummary = isModularProject
    ? selectedModuleLabel(modules, importModuleId)
    : null

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      data-tour-ready={project ? 'import' : undefined}
    >
      <PageStickyHeader maxWidth="6xl">
        <PageHeader
          title="Import / Export"
          badge={
            project ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-xs">
                  {project.slug}
                </Badge>
                <Badge variant="outline" className="font-mono text-xs uppercase">
                  {project.base_language} → {targetCount} target{targetCount === 1 ? '' : 's'}
                </Badge>
                <Badge variant="secondary" className="capitalize">
                  {project.layout} layout
                </Badge>
              </div>
            ) : undefined
          }
        />
      </PageStickyHeader>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 pb-12 sm:px-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
          {/* Inbound Staging Bay — Import */}
          <Card
            data-tour="import-lock"
            style={{ '--stagger': 2 } as React.CSSProperties}
            className="animate-stage-in flex flex-col justify-between overflow-hidden border-border/80 shadow-xs"
          >
            <CardHeader className="border-b border-border/50 bg-muted/15 pb-4">
              <CardTitle className="flex items-center gap-2.5">
                <MarkWell>
                  <Upload className="size-4" aria-hidden="true" />
                </MarkWell>
                <span>Import Strings</span>
              </CardTitle>
              <CardDescription>
                Stage a JSON or Excel file into a single target locale with conflict checking.
              </CardDescription>
              <CardAction>
                <Badge
                  variant="outline"
                  className={`font-mono text-3xs ${
                    dryRun
                      ? 'border-border/80 bg-muted/50 text-muted-foreground'
                      : 'border-primary/35 bg-primary/10 text-primary'
                  }`}
                >
                  {dryRun ? (
                    <ShieldCheck className="mr-1 size-3" aria-hidden="true" />
                  ) : (
                    <Zap className="mr-1 size-3" aria-hidden="true" />
                  )}
                  {dryRun ? 'Dry run' : 'Direct apply'}
                </Badge>
              </CardAction>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-5 pt-5">
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="import_locale">Target locale</FieldLabel>
                  <Select value={targetLocale} onValueChange={setImportLocale}>
                    <SelectTrigger id="import_locale" className="h-9 w-full">
                      <SelectValue placeholder="Target locale" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {locales.map((l) => (
                          <SelectItem key={l} value={l}>
                            {formatLocaleDisplay(l)}
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
                    <SelectTrigger id="import_mode" className="h-9 w-full">
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
                      <SelectTrigger id="import_module" className="h-9 w-full">
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
                    <p className="mt-1 text-2xs text-muted-foreground">
                      Applied to JSON uploads. Excel workbooks use module mappings in{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-3xs">
                        _meta
                      </code>{' '}
                      (or sheet names for legacy files).
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

              <button
                type="button"
                data-tour="import-file"
                onClick={() => fileRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!isDragging) setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                disabled={importBusy}
                className={`galley-grid group relative flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-7 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 ${
                  isDragging
                    ? 'border-primary bg-primary/[0.08] ring-2 ring-primary/20'
                    : 'border-border/90 bg-muted/25 hover:border-primary/55 hover:bg-primary/[0.03]'
                }`}
              >
                <MarkWell className="mb-3 transition-transform duration-200 group-hover:-translate-y-0.5">
                  <Upload aria-hidden="true" className="size-4" />
                </MarkWell>
                <span className="text-sm font-medium text-foreground">
                  {isDragging ? 'Release to upload file' : 'Click to browse or drop .json or .xlsx'}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  Max 10 MB · Dotted keys stay intact ·{' '}
                  {dryRun ? 'Preview opens before writing' : 'Writes immediately'}
                </span>
                <div className="mt-3.5 flex flex-wrap items-center justify-center gap-1.5 font-mono text-2xs text-muted-foreground">
                  <span className="rounded-md border border-border/80 bg-background/90 px-2 py-0.5 text-foreground">
                    {targetLocale.toUpperCase()}
                  </span>
                  {moduleSummary ? (
                    <span className="rounded-md border border-border/80 bg-background/90 px-2 py-0.5">
                      module: {moduleSummary}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-md border px-2 py-0.5 ${
                      dryRun
                        ? 'border-border/80 bg-background/90 text-muted-foreground'
                        : 'border-primary/30 bg-primary/10 text-primary'
                    }`}
                  >
                    {dryRun ? 'preview diff' : 'immediate write'}
                  </span>
                </div>
              </button>

              {trackedJobId ? (
                <div className="rounded-lg border border-border/75 bg-muted/20 p-3.5">
                  <JobProgress
                    progress={importJob.data?.progress}
                    error={importJob.isError ? importJob.error : undefined}
                    paused={importJob.isPaused}
                    label={importProgressLabel(importJob.data?.progress)}
                  />
                </div>
              ) : null}
            </CardContent>

            <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-muted/20 pt-4">
              <Button
                variant={dryRun ? 'outline' : 'default'}
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
                {importJobId
                  ? 'Importing…'
                  : importMut.isPending
                    ? 'Uploading…'
                    : 'Choose file (JSON or XLSX)'}
              </Button>
              <span className="text-2xs text-muted-foreground">
                One import per project at a time · Reversible from Activity
              </span>
            </CardFooter>
          </Card>

          {/* Outbound Bundle Builder — Export */}
          <Card
            style={{ '--stagger': 3 } as React.CSSProperties}
            className="animate-stage-in flex flex-col justify-between overflow-hidden border-border/80 shadow-xs"
          >
            <CardHeader className="border-b border-border/50 bg-muted/15 pb-4">
              <CardTitle className="flex items-center gap-2.5">
                <MarkWell>
                  <Download className="size-4" aria-hidden="true" />
                </MarkWell>
                <span>Export Catalog</span>
              </CardTitle>
              <CardDescription>
                Download a snapshot formatted for app builds or offline translation review.
              </CardDescription>
              <CardAction>
                <Badge
                  variant={exportStage === 'public' ? 'default' : 'outline'}
                  className="font-mono text-3xs uppercase"
                >
                  {exportStage === 'public' ? 'Published' : 'Working copy'}
                </Badge>
              </CardAction>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-5 pt-5">
              <ExportManifestPanel
                format={exportFormat}
                layout={layout}
                stage={exportStage}
                locale={exportLocale}
              />

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="export_format">Format</FieldLabel>
                  <Select
                    value={exportFormat}
                    onValueChange={(v) => setExportFormat(v as 'json' | 'xlsx')}
                  >
                    <SelectTrigger id="export_format" className="h-9 w-full">
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
                  <Select
                    value={layout}
                    onValueChange={(v) => setExportLayout(v as ProjectLayout)}
                  >
                    <SelectTrigger id="export_layout" className="h-9 w-full">
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
                    <SelectTrigger id="export_stage" className="h-9 w-full">
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
                    <SelectTrigger id="export_locale" className="h-9 w-full">
                      <SelectValue placeholder="Locale" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">All locales</SelectItem>
                        {locales.map((l) => (
                          <SelectItem key={l} value={l}>
                            {formatLocaleDisplay(l)}
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
                className="w-full shadow-xs sm:w-auto"
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
        </div>

        <SchemaContractSection
          baseLanguage={project?.base_language ?? 'vi'}
          isModularProject={isModularProject}
          templatePending={templateMut.isPending}
          onDownloadTemplate={(format) => templateMut.mutate(format)}
        />
      </div>

      <ImportPreviewDialog
        open={showPreview}
        result={previewResult}
        pending={importBusy}
        onCancel={() => setShowPreview(false)}
        onApply={confirmImport}
      />
    </div>
  )
}
