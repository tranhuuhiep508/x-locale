import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modulesApi } from '@/lib/api/catalog'
import type { Module } from '@/lib/api/types'
import { ModulesPage } from './ModulesPage'

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ projectId: 'p1' }),
    useSearch: () => ({}),
  }),
}))

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock('@/lib/api/catalog', () => ({
  modulesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleModules: Module[] = [
  {
    id: 'mod-1',
    slug: 'auth',
    name: 'Authentication',
    description: 'Auth related strings',
    position: 0,
    string_count: 5,
  },
]

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ModulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(modulesApi.list).mockResolvedValue(sampleModules)
  })

  it('renders modules list heading and module rows', async () => {
    renderWithClient(<ModulesPage />)

    expect(await screen.findByRole('heading', { name: 'Modules' })).toBeTruthy()
    expect(await screen.findByText('Authentication')).toBeTruthy()
    expect(screen.getByText('auth')).toBeTruthy()
  })

  it('validates invalid slug format in create module form', async () => {
    renderWithClient(<ModulesPage />)

    const newBtn = await screen.findByRole('button', { name: /New module/i })
    fireEvent.click(newBtn)

    expect(await screen.findByRole('heading', { name: 'New module' })).toBeTruthy()

    const slugInput = screen.getByLabelText(/Slug/i)
    const nameInput = screen.getByLabelText(/Name/i)
    const submitBtn = screen.getByRole('button', { name: 'Create' })

    // Invalid slug (uppercase/spaces)
    fireEvent.change(slugInput, { target: { value: 'Invalid Slug!' } })
    fireEvent.change(nameInput, { target: { value: 'Valid Name' } })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/Slug must start with a letter/i)).toBeTruthy()
    expect(modulesApi.create).not.toHaveBeenCalled()
  })

  it('submits valid module creation', async () => {
    vi.mocked(modulesApi.create).mockResolvedValue({
      id: 'mod-2',
      slug: 'checkout',
      name: 'Checkout Flow',
      description: null,
      position: 1,
      string_count: 0,
    })

    renderWithClient(<ModulesPage />)

    const newBtn = await screen.findByRole('button', { name: /New module/i })
    fireEvent.click(newBtn)

    const slugInput = await screen.findByLabelText(/Slug/i)
    const nameInput = screen.getByLabelText(/Name/i)

    fireEvent.change(slugInput, { target: { value: 'checkout' } })
    fireEvent.change(nameInput, { target: { value: 'Checkout Flow' } })

    const submitBtn = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(modulesApi.create).toHaveBeenCalledWith('p1', {
        slug: 'checkout',
        name: 'Checkout Flow',
        description: '',
      })
    })
  })
})
