import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectsApi } from '@/lib/api/projects'
import { queryKeys } from '@/lib/query-keys'
import { ProjectMembersSection } from './ProjectMembersSection'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/api/auth', () => ({
  authApi: { me: vi.fn().mockResolvedValue({ id: 'me', email: 'dev@example.com', name: 'Dev' }) },
}))
vi.mock('@/lib/api/projects', () => ({
  projectsApi: {
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn().mockResolvedValue({}),
    removeMember: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    children: ReactNode
  }) => (
    <select
      aria-label="member-role"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="admin">Admin</option>
      <option value="editor">Editor</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: () => null,
}))

const meMember = {
  user_id: 'me',
  email: 'dev@example.com',
  name: 'Dev',
  role: 'admin' as const,
  created_at: null,
}
const otherAdmin = {
  user_id: 'u-ed',
  email: 'ed@example.com',
  name: 'Ed',
  role: 'admin' as const,
  created_at: null,
}

function renderMembers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const remove = vi.spyOn(client, 'removeQueries')
  render(
    <QueryClientProvider client={client}>
      <ProjectMembersSection projectId="demo" isAdmin />
    </QueryClientProvider>,
  )
  return { invalidate, remove }
}

describe('member role and leave refresh', () => {
  beforeEach(() => {
    navigate.mockReset()
    vi.mocked(projectsApi.listMembers).mockReset().mockResolvedValue([meMember, otherAdmin])
    vi.mocked(projectsApi.updateMember).mockClear()
    vi.mocked(projectsApi.removeMember).mockClear()
  })

  it('refreshes the project detail and list after a self-demote', async () => {
    const { invalidate } = renderMembers()
    const [ownRole] = await screen.findAllByLabelText('member-role')
    fireEvent.change(ownRole, { target: { value: 'editor' } })
    await waitFor(() =>
      expect(projectsApi.updateMember).toHaveBeenCalledWith('demo', 'me', 'editor'),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.detail('demo') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.lists() })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('clears the project, refreshes the list, and goes home after leave', async () => {
    const { invalidate, remove } = renderMembers()
    fireEvent.click(await screen.findByRole('button', { name: 'Leave dev@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave project' }))
    await waitFor(() => expect(projectsApi.removeMember).toHaveBeenCalledWith('demo', 'me'))
    expect(remove).toHaveBeenCalledWith({ queryKey: queryKeys.projects.detail('demo') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.lists() })
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('asks before removing another member and stays on the page', async () => {
    const { remove } = renderMembers()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove ed@example.com' }))
    expect(projectsApi.removeMember).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))
    await waitFor(() => expect(projectsApi.removeMember).toHaveBeenCalledWith('demo', 'u-ed'))
    expect(remove).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
