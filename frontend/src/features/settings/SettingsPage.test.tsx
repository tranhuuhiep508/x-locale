import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectsApi } from '@/lib/api/projects'
import type { Project } from '@/lib/api/types'
import { SettingsPage } from './SettingsPage'

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useParams: () => ({ projectRef: 'demo' }) }),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/api/projects', () => ({
  projectsApi: {
    get: vi.fn(),
    listApiKeys: vi.fn(),
    update: vi.fn(),
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
  },
}))
vi.mock('@/lib/api/catalog', () => ({
  languagesApi: { list: vi.fn().mockResolvedValue([{ code: 'vi', name: 'Vietnamese' }, { code: 'en', name: 'English' }]) },
}))
vi.mock('@/lib/api/auth', () => ({
  authApi: { me: vi.fn().mockResolvedValue({ id: 'me', email: 'dev@example.com', name: 'Dev' }) },
}))

const project: Project = {
  id: 'p1', slug: 'demo', name: 'Demo', base_language: 'vi',
  target_languages: ['en'], layout: 'modular', string_count: 0,
  created_at: null, updated_at: null, translation_context: 'Friendly tone',
  role: 'admin',
}

const editorMember = {
  user_id: 'u-ed',
  email: 'ed@example.com',
  name: 'Ed',
  role: 'editor' as const,
  created_at: null,
}

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>)
}

describe('project translation context settings', () => {
  beforeEach(() => {
    vi.mocked(projectsApi.get).mockReset().mockResolvedValue(project)
    vi.mocked(projectsApi.listApiKeys).mockReset().mockResolvedValue([])
    vi.mocked(projectsApi.listMembers).mockReset().mockResolvedValue([])
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

describe('project settings and members by role', () => {
  beforeEach(() => {
    vi.mocked(projectsApi.listApiKeys).mockReset().mockResolvedValue([])
    vi.mocked(projectsApi.update).mockReset()
  })

  it('hides settings save and member management from an editor', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, role: 'editor' })
    vi.mocked(projectsApi.listMembers).mockResolvedValue([editorMember])
    renderSettings()
    expect(await screen.findByText('Only project admins can change these settings.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(await screen.findByText('ed@example.com')).toBeTruthy()
    expect(screen.getByText('Only admins can add or change members.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove ed@example.com' })).toBeNull()
    expect((screen.getByLabelText('Project name') as HTMLInputElement).disabled).toBe(true)
  })

  it('shows settings save and member management to an admin', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue(project)
    vi.mocked(projectsApi.listMembers).mockResolvedValue([editorMember])
    renderSettings()
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add member' })).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Remove ed@example.com' })).toBeTruthy()
    expect(screen.queryByText('Only admins can add or change members.')).toBeNull()
  })

  it('disables role changes and leave for the only admin', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue(project)
    vi.mocked(projectsApi.listMembers).mockResolvedValue([
      {
        user_id: 'me',
        email: 'dev@example.com',
        name: 'Dev',
        role: 'admin',
        created_at: null,
      },
    ])
    renderSettings()
    const leave = await screen.findByRole('button', { name: 'Leave dev@example.com' }) as HTMLButtonElement
    expect(leave.disabled).toBe(true)
    const role = screen.getByRole('combobox', { name: 'Role for dev@example.com' }) as HTMLButtonElement
    expect(role.disabled).toBe(true)
  })

  it('lets an editor revoke only their own API key', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, role: 'editor' })
    vi.mocked(projectsApi.listMembers).mockResolvedValue([editorMember])
    vi.mocked(projectsApi.listApiKeys).mockResolvedValue([
      {
        id: 'k-mine', name: 'mine', key_prefix: 'xlocale_mine', created_by: 'me',
        created_at: null, last_used_at: null, revoked_at: null,
      },
      {
        id: 'k-ci', name: 'ci', key_prefix: 'xlocale_ci00', created_by: 'someone',
        created_at: null, last_used_at: null, revoked_at: null,
      },
    ])
    renderSettings()
    const own = await screen.findByRole('button', { name: 'Revoke mine' }) as HTMLButtonElement
    const other = screen.getByRole('button', { name: 'Revoke ci' }) as HTMLButtonElement
    expect(own.disabled).toBe(false)
    expect(other.disabled).toBe(true)
    expect(other.title).toBe('Only an admin can revoke another member’s key')
    fireEvent.click(other)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('lets an admin revoke another member API key', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue(project)
    vi.mocked(projectsApi.listMembers).mockResolvedValue([editorMember])
    vi.mocked(projectsApi.listApiKeys).mockResolvedValue([
      {
        id: 'k-ci', name: 'ci', key_prefix: 'xlocale_ci00', created_by: 'someone',
        created_at: null, last_used_at: null, revoked_at: null,
      },
    ])
    renderSettings()
    const revoke = await screen.findByRole('button', { name: 'Revoke ci' }) as HTMLButtonElement
    expect(revoke.disabled).toBe(false)
  })
})
