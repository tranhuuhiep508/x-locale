import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, Module, Project, Tag } from '@/lib/api/types'
import { AddManyStringsDialog } from './AddManyStringsDialog'

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock('@/lib/api/catalog', () => ({
  modulesApi: { create: vi.fn() },
  tagsApi: { create: vi.fn() },
}))

vi.mock('@/lib/api/sync', () => ({
  syncApi: { importFile: vi.fn() },
}))

const project: Project = {
  id: 'proj-1',
  name: 'Demo App',
  slug: 'demo-app',
  base_language: 'vi',
  target_languages: ['en'],
  layout: 'modular',
  string_count: 10,
  created_at: null,
  updated_at: null,
}

const modules: Module[] = [
  { id: 'mod-common', slug: 'common', name: 'Common', description: null, position: 0, string_count: 4 },
]

const tags: Tag[] = [{ id: 'tag-ios', name: 'ios', color: '#2563eb', string_count: 0 }]

const dryResult: ImportResult = {
  created: 0,
  updated: 0,
  total: 2,
  dry_run: true,
  batch_id: null,
  diff: {
    create: ['e2e_new'],
    update: ['save'],
    orphan: [],
    noop: ['cancel'],
    create_count: 1,
    update_count: 1,
    orphan_count: 0,
    noop_count: 1,
  },
}

const applyResult: ImportResult = {
  ...dryResult,
  created: 1,
  updated: 1,
  dry_run: false,
  batch_id: 'batch-1',
}

function polyfillPointer() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => {},
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => {},
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  })
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
}

function renderDialog(onSuccess = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(
    <AddManyStringsDialog
      open
      projectId="proj-1"
      project={project}
      modules={modules}
      tags={tags}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
    { wrapper },
  )
  return { onSuccess, onClose }
}

describe('AddManyStringsDialog', () => {
  beforeEach(() => {
    polyfillPointer()
    vi.mocked(syncApi.importFile).mockReset()
  })

  it('rejects invalid JSON without calling import', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{not json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/Invalid JSON/)).toBeTruthy()
    expect(syncApi.importFile).not.toHaveBeenCalled()
  })

  it('rejects nested objects without calling import', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"welcome": {"en": "Hi"}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/string value/)).toBeTruthy()
    expect(syncApi.importFile).not.toHaveBeenCalled()
  })

  it('shows an empty preview and disables Apply', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('Nothing to add')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    expect(syncApi.importFile).not.toHaveBeenCalled()
  })

  it('dry-runs then applies through the JSON import endpoint', async () => {
    const { onSuccess, onClose } = renderDialog()
    vi.mocked(syncApi.importFile)
      .mockResolvedValueOnce(dryResult)
      .mockResolvedValueOnce(applyResult)

    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"save": "Lưu lại", "e2e_new": "Mới", "cancel": "Hủy"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(syncApi.importFile).toHaveBeenCalledTimes(1))
    const dryParams = vi.mocked(syncApi.importFile).mock.calls[0][2]
    expect(dryParams).toMatchObject({
      locale: 'vi',
      dry_run: 'true',
      status: 'draft',
      partial: 'true',
    })
    expect(await screen.findByText('1 create · 1 update · 1 no-op')).toBeTruthy()
    expect(screen.getByLabelText('Create')).toBeTruthy()
    expect(screen.getByText('e2e_new')).toBeTruthy()
    expect(screen.getByLabelText('Update')).toBeTruthy()
    expect(screen.getByText('save')).toBeTruthy()
    expect(screen.getByLabelText('No-op')).toBeTruthy()
    expect(screen.getByText('cancel')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search keys'), { target: { value: 'e2e_new' } })
    await waitFor(() => {
      expect(screen.getByText('e2e_new')).toBeTruthy()
      expect(screen.queryByText('save')).toBeNull()
      expect(screen.queryByText('cancel')).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(syncApi.importFile).toHaveBeenCalledTimes(2))
    expect(vi.mocked(syncApi.importFile).mock.calls[1][2]).toMatchObject({
      dry_run: 'false',
      status: 'draft',
      partial: 'true',
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces every dry-run key through search', async () => {
    const create = Array.from({ length: 120 }, (_, i) => `k${String(i).padStart(3, '0')}`)
    vi.mocked(syncApi.importFile).mockResolvedValueOnce({
      created: 0,
      updated: 0,
      total: 121,
      dry_run: true,
      batch_id: null,
      diff: {
        create,
        update: [],
        orphan: [],
        noop: ['save'],
        create_count: 120,
        update_count: 0,
        orphan_count: 0,
        noop_count: 1,
      },
    })
    renderDialog()
    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: JSON.stringify(Object.fromEntries([...create.map((key) => [key, 'v']), ['save', 'Lưu']])) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('120 create · 1 no-op')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search keys'), { target: { value: 'k119' } })
    await waitFor(() => expect(screen.getByText('k119')).toBeTruthy())
    expect(screen.queryByText('k000')).toBeNull()
    expect(screen.queryByText('save')).toBeNull()
  })

  it('Cancel on preview back does not apply', async () => {
    const { onSuccess } = renderDialog()
    vi.mocked(syncApi.importFile).mockResolvedValueOnce(dryResult)

    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"e2e_new": "Mới"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('e2e_new')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(syncApi.importFile).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
