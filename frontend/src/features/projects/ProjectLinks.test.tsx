import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectSidebar } from '@/components/layout/ProjectSidebar'
import type { Project } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { ProjectListPage } from './ProjectListPage'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: {
    children: ReactNode
    to: string
    params?: { projectRef: string }
  }) => <a href={to.replace('$projectRef', params?.projectRef ?? '')}>{children}</a>,
  useRouterState: () => '/projects/demo-app/strings',
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/sidebar', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Sidebar: Wrapper,
    SidebarContent: Wrapper,
    SidebarGroup: Wrapper,
    SidebarGroupContent: Wrapper,
    SidebarHeader: Wrapper,
    SidebarMenu: Wrapper,
    SidebarMenuButton: Wrapper,
    SidebarMenuItem: Wrapper,
    SidebarRail: Wrapper,
  }
})

vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

const project: Project = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  slug: 'demo-app',
  name: 'Demo App',
  base_language: 'vi',
  target_languages: ['en'],
  layout: 'flat',
  string_count: 1,
  created_at: null,
  updated_at: null,
  translation_context: null,
}

describe('project links', () => {
  it('uses the slug in project cards', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(queryKeys.projects.list(), [project])
    render(<QueryClientProvider client={queryClient}><ProjectListPage /></QueryClientProvider>)
    expect(screen.getByRole('link', { name: /Demo App/ }).getAttribute('href'))
      .toBe('/projects/demo-app/strings')
  })

  it('uses the slug in sidebar links', () => {
    render(<ProjectSidebar project={project} />)
    expect(screen.getByRole('link', { name: 'Strings' }).getAttribute('href'))
      .toBe('/projects/demo-app/strings')
  })
})
