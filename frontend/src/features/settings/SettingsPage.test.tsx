import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectsApi } from '@/lib/api/projects'
import type { Project } from '@/lib/api/types'
import { SettingsPage } from './SettingsPage'

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useParams: () => ({ projectRef: 'demo' }) }),
}))
vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/api/projects', () => ({
  projectsApi: { get: vi.fn(), listApiKeys: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/api/catalog', () => ({
  languagesApi: { list: vi.fn().mockResolvedValue([{ code: 'vi', name: 'Vietnamese' }, { code: 'en', name: 'English' }]) },
}))
vi.mock('@/lib/api/auth', () => ({
  authApi: { me: vi.fn().mockResolvedValue({ email: 'dev@example.com' }) },
}))

const project: Project = {
  id: 'p1', slug: 'demo', name: 'Demo', base_language: 'vi',
  target_languages: ['en'], layout: 'modular', string_count: 0,
  created_at: null, updated_at: null, translation_context: 'Friendly tone',
}

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>)
}

describe('project translation context settings', () => {
  beforeEach(() => {
    vi.mocked(projectsApi.get).mockReset().mockResolvedValue(project)
    vi.mocked(projectsApi.listApiKeys).mockReset().mockResolvedValue([])
    vi.mocked(projectsApi.update).mockReset().mockImplementation(async (_id, body) => ({
      ...project, ...body, translation_context: body.translation_context ?? null,
    }))
  })

  it('loads, saves, and clears context using the detail response', async () => {
    renderSettings()
    const input = await screen.findByLabelText('Translation context (optional)') as HTMLTextAreaElement
    expect(input.value).toBe('Friendly tone')
    expect(input.maxLength).toBe(500)
    expect(screen.getByText('13/500 characters')).toBeTruthy()
    fireEvent.change(input, { target: { value: '  Keep names  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(projectsApi.update).toHaveBeenCalledWith('demo', expect.objectContaining({ translation_context: 'Keep names' })))
    await waitFor(() => expect(input.value).toBe('Keep names'))
    fireEvent.change(input, { target: { value: ' \n ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(projectsApi.update).toHaveBeenLastCalledWith('demo', expect.objectContaining({ translation_context: null })))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('renders null context as an empty optional field', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, translation_context: null })
    renderSettings()
    expect((await screen.findByLabelText('Translation context (optional)') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByText('0/500 characters')).toBeTruthy()
  })

  it('rejects oversized context with accessible inline validation', async () => {
    renderSettings()
    const input = await screen.findByLabelText('Translation context (optional)')
    fireEvent.change(input, { target: { value: 'x'.repeat(501) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Translation context must be 500 characters or fewer')).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(projectsApi.update).not.toHaveBeenCalled()
  })

  it('retains edits after a failed save so the user can retry', async () => {
    vi.mocked(projectsApi.update).mockRejectedValueOnce(new Error('Save failed'))
    renderSettings()
    const input = await screen.findByLabelText('Translation context (optional)') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Keep my draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(projectsApi.update).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false))
    expect(input.value).toBe('Keep my draft')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(projectsApi.update).toHaveBeenCalledTimes(2))
  })
})
