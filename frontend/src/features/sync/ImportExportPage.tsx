import { getRouteApi } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import { Download, FileSpreadsheet, FileText, Upload } from 'lucide-react'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, ProjectLayout } from '@/lib/api/types'
import { modulesQuery, projectQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { PageBody, PageHeader } from '@/components/layout/PageHeader'
import { useToast } from '@/lib/toast'
import { ImportPreviewDialog } from '@/features/sync/ImportPreviewDialog'
import { DEMO_JSON_TEMPLATE, demoJsonFilename, demoJsonText } from '@/features/sync/import-templates'

const routeApi = getRouteApi('/projects/$projectId/import-export')
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
  const { projectId } = routeApi.useParams()
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
    mutationFn: async ({
      file,
      dry,
    }: {
      file: File
      dry: boolean
    }) => {
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

  const locales = project
    ? [project.base_language, ...project.target_languages]
    : []

  return (
    <PageBody>
      <PageHeader
        eyebrow="Project"
        title="Import / Export"
        description="Download a snapshot of this catalog, or bring strings in from JSON or Excel."
      />

      <Card className="sky-panel">
        <CardHeader>
          <p className="eyebrow">Outbound</p>
          <CardTitle>Export</CardTitle>
          <CardDescription>Download JSON or Excel using this project's layout.</CardDescription>
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

      <Card className="sky-panel">
        <CardHeader>
          <p className="eyebrow">Inbound</p>
          <CardTitle>Import</CardTitle>
          <CardDescription>
            Preview first, then apply. Secrets stay in the file you choose.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {isModularProject
                ? 'JSON keys are stored exactly as written. Pick a module below when you upload JSON. For Excel, each sheet name is the module slug.'
                : 'JSON keys are stored exactly as written. Excel uses one strings sheet; sheet names are not modules.'}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
              {demoJsonText().trimEnd()}
            </pre>
            {isModularProject ? (
              <p className="text-xs text-muted-foreground">
                CLI modular layout uses folders instead:{' '}
                <code className="rounded bg-muted px-1 py-0.5">
                  auth/{project?.base_language ?? 'vi'}.json
                </code>
                . Keys inside that file stay as-is; the folder name is the module.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                One file per language (for example{' '}
                <code className="rounded bg-muted px-1 py-0.5">
                  {demoJsonFilename(project?.base_language ?? 'vi')}
                </code>
                ). Choose the matching target locale when you import.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
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
            <p className="text-xs text-muted-foreground">
              Demo keys: {Object.keys(DEMO_JSON_TEMPLATE).join(', ')}. Replace values with your app
              copy before importing.
            </p>
          </div>

          <Separator />

          <FieldGroup>
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

              {isModularProject ? (
                <Field className="col-span-2">
                  <FieldLabel htmlFor="import_module">Module (JSON only)</FieldLabel>
                  <Select
                    value={importModuleId || NONE_MODULE}
                    onValueChange={(v) => setImportModuleId(v === NONE_MODULE ? '' : v)}
                  >
                    <SelectTrigger id="import_module" className="w-full">
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
                  <p className="text-xs text-muted-foreground">
                    Applied to JSON uploads. Excel ignores this and uses each sheet name as the
                    module slug.
                  </p>
                </Field>
              ) : null}
            </div>
          </FieldGroup>

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

            <p className="mt-2 text-xs text-muted-foreground">
              Accepted formats: .json, .xlsx — max 10 MB. A single-locale JSON file is applied to
              the target locale; exported multi-locale files import every locale they contain. Keys
              are never split on dots.
            </p>
          </div>
        </CardContent>
      </Card>

      <ImportPreviewDialog
        open={showPreview}
        result={previewResult}
        applying={importMut.isPending}
        onOpenChange={setShowPreview}
        onApply={confirmImport}
      />
    </PageBody>
  )
}
