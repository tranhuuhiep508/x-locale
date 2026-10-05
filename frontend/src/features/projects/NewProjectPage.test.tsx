import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectsApi } from '@/lib/api/projects'
import { NewProjectPage } from './NewProjectPage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/api/projects', () => ({ projectsApi: { create: vi.fn() } }))
vi.mock('@/lib/api/catalog', () => ({
  languagesApi: { list: vi.fn().mockResolvedValue([
    { code: 'en', name: 'English' }, { code: 'vi', name: 'Vietnamese' },
  ]) },
}))

async function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><NewProjectPage /></QueryClientProvider>)
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'New catalog' } })
  fireEvent.click(await screen.findByRole('button', { name: /Vietnamese/ }))
  return screen.getByLabelText('Translation context (optional)') as HTMLTextAreaElement
}

describe('project creation translation context', () => {
  beforeEach(() => {
    navigate.mockReset()
    vi.mocked(projectsApi.create).mockReset().mockResolvedValue({
      id: 'p1', slug: 'new-catalog', name: 'New catalog', base_language: 'en',
      target_languages: ['vi'], layout: 'flat', string_count: 0, created_at: null, updated_at: null,
    })
  })

  it('submits trimmed context with all project fields in one create request', async () => {
    const input = await renderForm()
    expect(input.value).toBe('')
    expect(input.maxLength).toBe(500)
    fireEvent.change(input, { target: { value: '  Use a friendly tone  ' } })
    expect(screen.getByText('23/500 characters')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(projectsApi.create).toHaveBeenCalledWith({
      name: 'New catalog', slug: 'new-catalog', base_language: 'en', target_languages: ['vi'],
      layout: 'flat', translation_context: 'Use a friendly tone',
    }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectRef/strings', params: { projectRef: 'new-catalog' }, search: {},
    }))
  })

  it('submits blank context as null', async () => {
    await renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(projectsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ translation_context: null }),
    ))
  })

  it('blocks oversized context with accessible validation', async () => {
    const input = await renderForm()
    fireEvent.change(input, { target: { value: 'x'.repeat(501) } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText('Translation context must be 500 characters or fewer')).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(projectsApi.create).not.toHaveBeenCalled()
  })

  it('retains the project and context after a failed create for retry', async () => {
    vi.mocked(projectsApi.create).mockRejectedValueOnce(new Error('Create failed'))
    const input = await renderForm()
    fireEvent.change(input, { target: { value: 'Keep product names' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(projectsApi.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(false))
    expect(input.value).toBe('Keep product names')
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('New catalog')
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(projectsApi.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
  })
})
