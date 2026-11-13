import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { languagesApi, modulesApi } from '@/lib/api/catalog'
import { projectsApi } from '@/lib/api/projects'
import { syncApi } from '@/lib/api/sync'
import type { Project } from '@/lib/api/types'
import { ImportExportPage } from './ImportExportPage'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ projectRef: 'demo-app' }),
  }),
}))

vi.mock('@/lib/toast', () => ({
  useToast: () => toastMock,
}))

vi.mock('@/lib/api/projects', () => ({
  projectsApi: {
    get: vi.fn(),
  },
}))

vi.mock('@/lib/api/catalog', () => ({
  languagesApi: {
    list: vi.fn(),
  },
  modulesApi: {
    list: vi.fn(),
  },
}))

vi.mock('@/lib/api/sync', () => ({
  syncApi: {
    importFile: vi.fn(),
    exportFile: vi.fn(),
    importTemplate: vi.fn(),
  },
}))

vi.mock('@/lib/active-job', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/active-job')>()),
  refreshProjectContent: vi.fn(),
}))

const modularProject: Project = {
  id: 'demo-id',
  slug: 'demo-app',
  name: 'Demo App',
  base_language: 'vi',
  target_languages: ['en', 'ja'],
  layout: 'modular',
  allow_duplicate_keys: false,
  can_change_base_language: false,
  string_count: 12,
  created_at: null,
  updated_at: null,
  translation_context: null,
}

function renderPage(ui: ReactNode = <ImportExportPage />) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(projectsApi.get).mockResolvedValue(modularProject)
  vi.mocked(languagesApi.list).mockResolvedValue([
    { code: 'vi', name: 'Vietnamese' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: 'Japanese' },
  ])
  vi.mocked(modulesApi.list).mockResolvedValue([
    {
      id: 'mod-common',
      slug: 'common',
      name: 'Common',
      description: null,
      translation_context: null,
      position: 0,
      string_count: 4,
    },
  ])
  vi.mocked(syncApi.exportFile).mockResolvedValue({
    blob: new Blob(['{}'], { type: 'application/json' }),
    filename: 'demo-app-draft.json',
  })
  vi.mocked(syncApi.importTemplate).mockResolvedValue({
    blob: new Blob(['xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename: 'import-template.xlsx',
  })
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: vi.fn(() => 'blob:mock'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    value: vi.fn(),
  })
})

describe('ImportExportPage', () => {
  it('renders project telemetry, tour hooks, and modular JSON module selector', async () => {
    const { container } = renderPage()

    expect(screen.getByRole('heading', { name: 'Import / Export' })).toBeTruthy()
    expect(await screen.findByText('demo-app')).toBeTruthy()
    expect(screen.getByText('vi → 2 targets')).toBeTruthy()
    expect(screen.getByText('modular layout')).toBeTruthy()

    expect(await screen.findByRole('combobox', { name: 'Module (JSON only)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Click to browse or drop/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose file (JSON or XLSX)' })).toBeTruthy()

    expect(container.querySelector('[data-tour-ready="import"]')).not.toBeNull()
    for (const target of [
      'import-lock',
      'import-conflicts',
      'import-file',
      'import-submit',
      'import-format',
    ]) {
      expect(container.querySelector(`[data-tour="${target}"]`)).not.toBeNull()
    }
  })

  it('rejects unsupported file extensions and oversized uploads before calling the API', async () => {
    renderPage()
    await screen.findByText('demo-app')

    const dropZone = screen.getByRole('button', { name: /Click to browse or drop/ })

    const txtFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    fireEvent.drop(dropZone, { dataTransfer: { files: [txtFile] } })
    expect(toastMock.error).toHaveBeenCalledWith('Choose a JSON (.json) or Excel (.xlsx) file')

    const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.json', {
      type: 'application/json',
    })
    fireEvent.drop(dropZone, { dataTransfer: { files: [bigFile] } })
    expect(toastMock.error).toHaveBeenCalledWith('File must be 10 MB or smaller')
    expect(syncApi.importFile).not.toHaveBeenCalled()
  })

  it('runs a dry-run preview and confirms import using the retained file', async () => {
    vi.mocked(syncApi.importFile)
      .mockResolvedValueOnce({
        dry_run: true,
        total: 1,
        created: 1,
        updated: 0,
        batch_id: null,
        diff: {
          create_count: 1,
          update_count: 0,
          orphan_count: 0,
          create: [{ key: 'hello.world', source_text: 'Xin chào' }],
          update: [],
          orphan: [],
        },
      })
      .mockResolvedValueOnce({
        dry_run: false,
        total: 1,
        created: 1,
        updated: 0,
        batch_id: 'batch-1',
        diff: {
          create_count: 1,
          update_count: 0,
          orphan_count: 0,
          create: [{ key: 'hello.world', source_text: 'Xin chào' }],
          update: [],
          orphan: [],
        },
      })

    renderPage()
    await screen.findByText('demo-app')

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const jsonFile = new File(['{"hello.world":"Xin chào"}'], 'vi.json', {
      type: 'application/json',
    })
    fireEvent.change(fileInput, { target: { files: [jsonFile] } })

    expect(await screen.findByRole('dialog', { name: 'Import preview (dry run)' })).toBeTruthy()
    expect(syncApi.importFile).toHaveBeenNthCalledWith(1, 'demo-app', expect.any(FormData), {
      locale: 'vi',
      dry_run: 'true',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Apply import' }))

    await waitFor(() => {
      expect(syncApi.importFile).toHaveBeenNthCalledWith(2, 'demo-app', expect.any(FormData), {
        locale: 'vi',
        dry_run: 'false',
      })
    })
    expect(toastMock.success).toHaveBeenCalledWith('Import complete: 1 created, 0 updated')
  })

  it('triggers export download with configured project layout and stage', async () => {
    renderPage()
    await screen.findByText('demo-app')

    expect(screen.getByText('Single JSON bundle (.json)')).toBeTruthy()
    expect(screen.getByText('JSON object grouped by module slug and locale.')).toBeTruthy()

    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }))

    await waitFor(() => {
      expect(syncApi.exportFile).toHaveBeenCalledWith('demo-app', {
        format: 'json',
        layout: 'modular',
        stage: 'draft',
        locale: undefined,
      })
    })
    anchorClickSpy.mockRestore()
  })

  it('switches the file contract specimen between JSON and Excel and downloads templates', async () => {
    renderPage()
    await screen.findByText('demo-app')

    expect(screen.getByText(/"common.save": "Lưu"/)).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '.xlsx' }))
    expect(screen.getByText('Worksheet: common (+ _meta)')).toBeTruthy()
    expect(screen.getByText('common.save')).toBeTruthy()

    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Excel example' }))
    await waitFor(() => {
      expect(syncApi.importTemplate).toHaveBeenCalledWith('demo-app', 'xlsx')
    })
    anchorClickSpy.mockRestore()
  })
})
