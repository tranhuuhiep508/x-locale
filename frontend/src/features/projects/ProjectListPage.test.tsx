import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { ProjectListPage } from './ProjectListPage'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: {
    children: ReactNode
    to: string
    params?: { projectRef: string }
  }) => <a href={to.replace('$projectRef', params?.projectRef ?? '')}>{children}</a>,
  useRouterState: () => '/projects',
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/api/projects', () => ({
  projectsApi: {
    list: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}))

const project: ProjectSummary = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  slug: 'demo-app',
  name: 'Demo App',
  base_language: 'vi',
  target_languages: ['en'],
  layout: 'flat',
  string_count: 1,
  created_at: null,
  updated_at: null,
}

function renderList(role: ProjectSummary['role']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  queryClient.setQueryData(queryKeys.projects.list(), [{ ...project, role }])
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectListPage />
    </QueryClientProvider>,
  )
}

describe('project delete confirm', () => {
  it('hides the trash control for an editor', () => {
    renderList('editor')
    expect(screen.queryByRole('button', { name: 'Delete Demo App' })).toBeNull()
  })

  it('enables delete only when the typed slug matches exactly', () => {
    renderList('admin')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Demo App' }))
    expect(screen.getByText(/no undo/i)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Delete project' }) as HTMLButtonElement
    const slug = screen.getByLabelText('Project slug')
    expect(confirm.disabled).toBe(true)

    fireEvent.change(slug, { target: { value: 'Demo App' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(slug, { target: { value: 'demo-app ' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(slug, { target: { value: 'demo-app' } })
    expect(confirm.disabled).toBe(false)
  })
})