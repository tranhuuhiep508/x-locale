import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activitiesApi } from '@/lib/api/activities'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi } from '@/lib/api/strings'
import type { Project } from '@/lib/api/types'
import { ProjectOverviewPage } from './ProjectOverviewPage'

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useParams: () => ({ projectRef: 'demo-app' }) }),
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: Omit<ComponentProps<'a'>, 'href'> & {
    children: ReactNode
    to: string
    params?: { projectRef: string }
    search?: Record<string, unknown>
  }) => {
    const query = new URLSearchParams(
      Object.entries(search ?? {}).map(([key, value]) => [key, String(value)])
    ).toString()
    return (
      <a
        {...props}
        href={`${to.replace('$projectRef', params?.projectRef ?? '')}${query ? `?${query}` : ''}`}
      >
        {children}
      </a>
    )
  },
}))
vi.mock('@/lib/api/activities', () => ({ activitiesApi: { feed: vi.fn() } }))
vi.mock('@/lib/api/catalog', () => ({
  languagesApi: { list: vi.fn() },
  modulesApi: { list: vi.fn() },
  tagsApi: { list: vi.fn() },
}))
vi.mock('@/lib/api/projects', () => ({ projectsApi: { get: vi.fn() } }))
vi.mock('@/lib/api/strings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/strings')>()),
  stringsApi: { list: vi.fn() },
}))

const project: Project = {
  id: 'demo-id',
  slug: 'demo-app',
  name: 'Demo App',
  base_language: 'vi',
  target_languages: ['en', 'ja'],
  layout: 'modular',
  string_count: 10,
  created_at: null,
  updated_at: null,
  translation_context: null,
}
let client: QueryClient

function renderOverview() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProjectOverviewPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  vi.mocked(languagesApi.list).mockResolvedValue([
    { code: 'vi', name: 'Vietnamese' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: 'Japanese' },
  ])
  vi.mocked(modulesApi.list).mockResolvedValue([])
  vi.mocked(tagsApi.list).mockResolvedValue([])
  vi.mocked(activitiesApi.feed).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 })
  vi.mocked(stringsApi.list).mockImplementation(async (_projectRef, params) => ({
    items: [],
    page: 1,
    page_size: 1,
    total:
      params.missing_locale === 'en'
        ? 3
        : params.missing_locale === 'ja'
          ? 0
          : params.has_unpublished_changes
            ? 4
            : 10,
  }))
})
afterEach(() => {
  cleanup()
  client?.clear()
})

describe('project overview', () => {
  it('shows working-copy coverage and links to the matching catalog filters', async () => {
    renderOverview()
    await waitFor(() =>
      expect(
        screen
          .getByRole('progressbar', { name: 'English translation coverage' })
          .getAttribute('aria-valuenow')
      ).toBe('70')
    )
    expect(
      screen
        .getByRole('progressbar', { name: 'Japanese translation coverage' })
        .getAttribute('aria-valuenow')
    ).toBe('100')
    expect(screen.getByText('7 of 10 strings translated')).toBeTruthy()
    expect(screen.getByRole('link', { name: /3 missing/ }).getAttribute('href')).toBe(
      '/projects/demo-app/strings?missing_locale=en'
    )
    expect(screen.getByRole('link', { name: /View translations/ }).getAttribute('href')).toBe(
      '/projects/demo-app/strings?complete_locale=ja'
    )
    expect(screen.getByRole('link', { name: /Pending edits 4/ }).getAttribute('href')).toBe(
      '/projects/demo-app/strings?has_unpublished_changes=true'
    )
  })

  it('shows an empty catalog without claiming completed translations or querying missing counts', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, string_count: 0 })
    vi.mocked(stringsApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 1 })
    renderOverview()
    await screen.findByRole('progressbar', { name: 'English translation coverage' })
    expect(screen.getAllByText('No strings yet')).toHaveLength(2)
    expect(
      screen
        .getByRole('progressbar', { name: 'English translation coverage' })
        .getAttribute('aria-valuenow')
    ).toBe('0')
    expect(screen.getAllByRole('link', { name: /View strings/ })).toHaveLength(2)
    expect(vi.mocked(stringsApi.list).mock.calls.some(([, params]) => params.missing_locale)).toBe(
      false
    )
  })

  it('offers a retry for unavailable coverage instead of showing a misleading zero', async () => {
    const list = vi.mocked(stringsApi.list).getMockImplementation()!
    vi.mocked(stringsApi.list).mockImplementation((ref, params) =>
      params.missing_locale === 'en' ? Promise.reject(new Error('Offline')) : list(ref, params)
    )
    renderOverview()
    await screen.findByText('Unavailable')
    expect(screen.queryByRole('progressbar', { name: 'English translation coverage' })).toBeNull()
    vi.mocked(stringsApi.list).mockImplementation(list)
    fireEvent.click(screen.getByRole('button', { name: 'Retry English coverage' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('progressbar', { name: 'English translation coverage' })
          .getAttribute('aria-valuenow')
      ).toBe('70')
    )
  })

  it('guides projects without target languages to settings', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, target_languages: [] })
    renderOverview()
    await screen.findByText('Add a target language')
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('link', { name: /Manage languages/ }).getAttribute('href')).toBe(
      '/projects/demo-app/settings'
    )
  })

  it('keeps activity errors distinct from an empty activity feed', async () => {
    vi.mocked(activitiesApi.feed).mockRejectedValue(new Error('Offline'))
    renderOverview()
    await screen.findByText('Couldn’t load activity')
    expect(screen.queryByText('No activity yet')).toBeNull()
  })
})
