import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi } from '@/lib/api/strings'
import type { Project, StringEntry } from '@/lib/api/types'
import type { StringsSearch } from '@/lib/schemas'
import { stringsQuery } from '@/lib/queries'
import { StringsPage } from './StringsPage'

const navigate = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const useSearch = vi.hoisted(() => vi.fn<() => StringsSearch>(() => ({})))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ projectRef: 'demo-app' }),
    useSearch,
  }),
  useNavigate: () => navigate,
}))

vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/lib/api/catalog', () => ({
  languagesApi: { list: vi.fn() },
  modulesApi: { list: vi.fn() },
  tagsApi: { list: vi.fn() },
}))

vi.mock('@/lib/api/projects', () => ({
  projectsApi: { get: vi.fn() },
}))

vi.mock('@/lib/api/strings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/strings')>()),
  stringsApi: {
    list: vi.fn(), get: vi.fn(), editorSave: vi.fn(), editorPreview: vi.fn(), translateMemory: vi.fn(), translateQa: vi.fn(),
    publishPreview: vi.fn(), batch: vi.fn(),
  },
}))

const project: Project = {
  id: 'demo-id',
  slug: 'demo-app',
  name: 'Demo App',
  base_language: 'vi',
  target_languages: ['en'],
  layout: 'modular',
  allow_duplicate_keys: false,
  string_count: 2,
  created_at: null,
  updated_at: null,
  can_change_base_language: false,
  translation_context: null,
}

const rows: StringEntry[] = [
  {
    id: 's1',
    key: 'auth.login.title',
    source_text: 'Đăng nhập',
    description: 'Modal heading',
    status: 'public',
    pending_delete: false,
    deleted_at: null,
    has_unpublished_changes: true,
    published_at: '2026-01-01T00:00:00Z',
    published_key: 'auth.login.title',
    published_source_text: 'Đăng nhập cũ',
    published_module_id: 'm1',
    published_module_slug: 'auth',
    module_id: 'm1',
    module_slug: 'auth',
    tags: [{ id: 't1', name: 'core', color: '#1F6FEB', string_count: 1 }],
    created_at: '2026-01-01T00:00:00Z',
    created_by_type: null,
    created_by_label: null,
    updated_at: '2026-01-02T00:00:00Z',
    updated_by_type: 'user',
    updated_by_label: 'Alex',
    translations: [
      {
        id: 'tr1',
        locale: 'en',
        value: 'Sign in',
        published_value: 'Sign in',
        confidence: null,
        updated_at: '2026-01-02T00:00:00Z',
      },
    ],
  },
  {
    id: 's2',
    key: 'auth.login.submit',
    source_text: 'Tiếp tục',
    description: null,
    status: 'draft',
    pending_delete: false,
    deleted_at: null,
    has_unpublished_changes: false,
    published_at: null,
    published_key: null,
    published_source_text: null,
    published_module_id: null,
    published_module_slug: null,
    module_id: 'm1',
    module_slug: 'auth',
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    created_by_type: null,
    created_by_label: null,
    updated_at: '2026-01-02T00:00:00Z',
    updated_by_type: null,
    updated_by_label: null,
    translations: [],
  },
]

let client: QueryClient

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <StringsPage />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.clear()
  useSearch.mockReturnValue({})
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  vi.mocked(languagesApi.list).mockResolvedValue([])
  vi.mocked(modulesApi.list).mockResolvedValue([])
  vi.mocked(tagsApi.list).mockResolvedValue([])
  vi.mocked(stringsApi.list).mockResolvedValue({
    items: rows,
    total: rows.length,
    page: 1,
    page_size: 20,
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})

describe('StringsPage revamp', () => {
  it('displays visible catalog telemetry, module chips, and supports density toggling', async () => {
    renderPage()

    expect(await screen.findByText('2 strings · 1 target language')).toBeTruthy()
    const region = screen.getByRole('region', { name: 'Strings catalog' })
    expect(region.getAttribute('data-density')).toBe('comfortable')

    fireEvent.click(screen.getByRole('button', { name: 'Compact density' }))
    expect(region.getAttribute('data-density')).toBe('compact')
    expect(window.localStorage.getItem('x-locale:strings-density')).toBe('compact')

    fireEvent.click(screen.getByRole('button', { name: 'Comfortable density' }))
    expect(region.getAttribute('data-density')).toBe('comfortable')
    expect(window.localStorage.getItem('x-locale:strings-density')).toBe('comfortable')
  })

  it('switches quick views without retaining the previous view filter', async () => {
    useSearch.mockReturnValue({ missing_any: true })
    renderPage()
    const pending = await screen.findByRole('button', { name: 'Needs publish' })
    expect(pending.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(pending)
    const pendingSearch = navigate.mock.lastCall?.[0].search as (previous: StringsSearch) => StringsSearch
    expect(pendingSearch({ missing_any: true, page: 4 })).toMatchObject({
      missing_any: undefined,
      has_unpublished_changes: true,
      page: 1,
    })

    cleanup()
    useSearch.mockReturnValue({ has_unpublished_changes: true })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Missing translations' }))
    const missingSearch = navigate.mock.lastCall?.[0].search as (previous: StringsSearch) => StringsSearch
    expect(missingSearch({ has_unpublished_changes: true, page: 4 })).toMatchObject({
      has_unpublished_changes: undefined,
      missing_any: true,
      page: 1,
    })
  })

  it.each(['missing_locale', 'complete_locale'] as const)(
    'does not mark All strings active when %s is filtered',
    async (localeFilter) => {
      useSearch.mockReturnValue({ [localeFilter]: 'fr' })
      renderPage()
      const all = await screen.findByRole('button', { name: 'All strings' })
      expect(all.getAttribute('aria-pressed')).toBe('false')

      fireEvent.click(all)
      const nextSearch = navigate.mock.lastCall?.[0].search as (previous: StringsSearch) => StringsSearch
      expect(nextSearch({ [localeFilter]: 'fr', page: 4 })).toMatchObject({
        [localeFilter]: undefined,
        page: 1,
      })
    }
  )

  it('does not mark a quick view active while another view filter narrows it', async () => {
    useSearch.mockReturnValue({ missing_any: true, status: 'public' })
    renderPage()
    expect((await screen.findByRole('button', { name: 'Missing translations' })).getAttribute('aria-pressed')).toBe('false')

    cleanup()
    useSearch.mockReturnValue({ has_unpublished_changes: true, missing_any: true })
    renderPage()
    expect((await screen.findByRole('button', { name: /Needs publish/ })).getAttribute('aria-pressed')).toBe('false')

    cleanup()
    useSearch.mockReturnValue({ deleted: true, missing_locale: 'en' })
    renderPage()
    expect((await screen.findByRole('button', { name: 'Deleted' })).getAttribute('aria-pressed')).toBe('false')
  })

  it('supports arrow-key navigation in the Add string menu', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add string' }))
    const first = await screen.findByRole('menuitem', { name: 'Add single string' })
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(first))
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Add many' }))
    )
  })

  it('focuses the search input on "/" shortcut without hijacking input typing', async () => {
    renderPage()
    const search = await screen.findByRole('textbox', { name: 'Search strings' })
    expect(document.activeElement).not.toBe(search)

    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(search)
  })

  it('copies a string key without opening the edit dialog', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderPage()
    const copyBtn = await screen.findByRole('button', { name: 'Copy key auth.login.title' })
    fireEvent.click(copyBtn)

    expect(writeText).toHaveBeenCalledWith('auth.login.title')
    expect(screen.queryByRole('heading', { name: 'Edit string' })).toBeNull()
  })

  it('shows the floating batch action dock when rows are selected', async () => {
    renderPage()
    const checkboxes = await screen.findAllByRole('checkbox', { name: 'Select row' })
    fireEvent.click(checkboxes[0])

    expect(await screen.findByRole('toolbar', { name: 'Batch actions' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('1–2 of 2')).toBeTruthy()
    })
  })

  it('offers Clear filters on a filtered empty state', async () => {
    useSearch.mockReturnValue({ q: 'nonexistent' })
    vi.mocked(stringsApi.list).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    })

    renderPage()
    const clearBtn = await screen.findByRole('button', { name: 'Clear filters' })
    fireEvent.click(clearBtn)
    expect(navigate).toHaveBeenCalledWith({
      search: {
        page: 1,
        page_size: 20,
        sort: undefined,
        order: undefined,
      },
    })
  })
})

describe('save and publish feedback', () => {
  it.each([false, true])('fetches the latest string when clicking an older toast (cached: %s)', async (cached) => {
    client.setDefaultOptions({ queries: { retry: false, staleTime: 120_000 } })
    const earlier = { ...rows[0], source_text: 'Earlier saved draft' }
    const latest = { ...rows[0], source_text: 'Latest concurrent edit' }
    let resolveLatest!: (entry: StringEntry) => void
    vi.mocked(stringsApi.get).mockImplementation(() => new Promise((resolve) => { resolveLatest = resolve }))
    vi.mocked(stringsApi.editorSave).mockResolvedValue(earlier)
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: rows[0].source_text, matches: {} })
    const view = renderPage()
    fireEvent.click(await screen.findByText('Đăng nhập'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit string' })
    fireEvent.change(within(dialog).getByLabelText('Source text'), { target: { value: earlier.source_text } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    if (cached) {
      client.setQueryData(stringsQuery('demo-app', { saved_string: earlier.id }).queryKey, {
        items: [earlier], total: 1, page: 1, page_size: 1,
      })
    }
    act(() => toastSuccess.mock.calls[0][1].action.onClick())
    useSearch.mockReturnValue(navigate.mock.lastCall![0].search)
    view.rerender(
      <QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>,
    )
    await waitFor(() => expect(stringsApi.get).toHaveBeenCalledWith('demo-app', earlier.id))
    await act(async () => resolveLatest(latest))
    const latestCell = await screen.findByText(latest.source_text)
    expect(screen.queryByText(earlier.source_text)).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(latestCell.closest('tr')))
  })

  it.each(['save_draft', 'publish'] as const)('closes the editor and preserves filters until the toast action (%s)', async (action) => {
    const search: StringsSearch = { q: 'auth', status: 'draft', module: 'm1', page: 3, page_size: 20, sort: 'key', order: 'desc' }
    useSearch.mockReturnValue(search)
    vi.mocked(stringsApi.editorSave).mockResolvedValue(rows[0])
    vi.mocked(stringsApi.editorPreview).mockResolvedValue({ entry: rows[0], fingerprint: 'review' })
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: rows[0].source_text, matches: {} })
    renderPage()
    fireEvent.click(await screen.findByText('Đăng nhập'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit string' })
    fireEvent.change(within(dialog).getByLabelText('Source text'), { target: { value: 'Updated source' } })
    fireEvent.click(within(dialog).getByRole('button', { name: action === 'publish' ? 'Publish changes' : 'Save as draft' }))
    if (action === 'publish') fireEvent.click(await within(dialog).findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith(action === 'publish' ? 'String saved and published' : 'String saved as draft', {
      duration: 8000, action: { label: 'View changes', onClick: expect.any(Function) },
    })
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Search strings' })).toHaveProperty('value', 'auth')
    const catalogRequests = vi.mocked(stringsApi.list).mock.calls.filter(([, params]) => params?.q === 'auth')
    expect(catalogRequests.length).toBeGreaterThanOrEqual(2)
    for (const [, params] of catalogRequests) expect(params).toMatchObject(search)
    act(() => toastSuccess.mock.calls[0][1].action.onClick())
    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectRef/strings', params: { projectRef: 'demo-app' },
      search: { q: rows[0].key, saved_string: rows[0].id, page: 1, page_size: 20, sort: 'key', order: 'desc' },
    })
  })

  it('adds a toast action for the published batch without changing filters', async () => {
    useSearch.mockReturnValue({ status: 'draft', page: 2, page_size: 20 })
    vi.mocked(stringsApi.publishPreview).mockResolvedValue({ items: [rows[0]], fingerprint: 'review' })
    vi.mocked(stringsApi.batch).mockResolvedValue({ affected: 1, batch_id: 'published-batch' })
    renderPage()
    fireEvent.click((await screen.findAllByRole('checkbox', { name: 'Select row' }))[0])
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Batch actions' })).getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    act(() => toastSuccess.mock.calls[0][1].action.onClick())
    const navigation = navigate.mock.calls[0][0]
    expect(navigation.params).toEqual({ projectRef: 'demo-app' })
    expect(navigation.search({ status: 'draft', page: 2, page_size: 20 }))
      .toEqual({ page: 1, page_size: 20, batch_id: 'published-batch' })
  })
})
