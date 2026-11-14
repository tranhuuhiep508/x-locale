import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi } from '@/lib/api/strings'
import type { Project, StringEntry } from '@/lib/api/types'
import type { StringsSearch } from '@/lib/schemas'
import { StringsPage } from './StringsPage'

const navigate = vi.hoisted(() => vi.fn())
const useSearch = vi.hoisted(() => vi.fn<() => StringsSearch>(() => ({})))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ projectRef: 'demo-app' }),
    useSearch,
  }),
  useNavigate: () => navigate,
}))

vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
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
    list: vi.fn(),
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
