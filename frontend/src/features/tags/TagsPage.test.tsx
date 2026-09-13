import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tagsApi } from '@/lib/api/catalog'
import type { Tag } from '@/lib/api/types'
import { TagsPage } from './TagsPage'

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
  tagsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleTags: Tag[] = [
  {
    id: 'tag-1',
    name: 'ios',
    color: '#2563eb',
    string_count: 8,
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

describe('TagsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(tagsApi.list).mockResolvedValue(sampleTags)
  })

  it('renders tags list heading and tag rows', async () => {
    renderWithClient(<TagsPage />)

    expect(await screen.findByRole('heading', { name: 'Tags' })).toBeTruthy()
    expect(await screen.findByText('ios')).toBeTruthy()
  })

  it('validates empty name in create tag form', async () => {
    renderWithClient(<TagsPage />)

    const newBtn = await screen.findByRole('button', { name: /New tag/i })
    fireEvent.click(newBtn)

    expect(await screen.findByRole('heading', { name: 'New tag' })).toBeTruthy()

    const submitBtn = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/Name is required/i)).toBeTruthy()
    expect(tagsApi.create).not.toHaveBeenCalled()
  })

  it('submits valid tag creation', async () => {
    vi.mocked(tagsApi.create).mockResolvedValue({
      id: 'tag-2',
      name: 'android',
      color: '#10b981',
      string_count: 0,
    })

    renderWithClient(<TagsPage />)

    const newBtn = await screen.findByRole('button', { name: /New tag/i })
    fireEvent.click(newBtn)

    const nameInput = await screen.findByLabelText(/Name/i)
    fireEvent.change(nameInput, { target: { value: 'android' } })

    const submitBtn = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(tagsApi.create).toHaveBeenCalledWith('p1', {
        name: 'android',
        color: '#64748b',
      })
    })
  })
})
