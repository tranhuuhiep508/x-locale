import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearActiveJob, getActiveJob, rememberJob } from '@/lib/active-job'
import { jobsApi } from '@/lib/api/jobs'
import { projectsApi } from '@/lib/api/projects'
import { syncApi } from '@/lib/api/sync'
import type { Project } from '@/lib/api/types'
import { ImportExportPage } from './ImportExportPage'

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useParams: () => ({ projectRef: 'proj-1' }) }),
}))
vi.mock('@/lib/api/projects', () => ({ projectsApi: { get: vi.fn() } }))
vi.mock('@/lib/api/sync', () => ({ syncApi: { importFile: vi.fn() } }))
vi.mock('@/lib/api/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/jobs')>()),
  jobsApi: { get: vi.fn() },
}))

const project: Project = {
  id: 'proj-1', slug: 'demo', name: 'Demo', layout: 'flat',
  base_language: 'vi', target_languages: ['en'], allow_duplicate_keys: false,
  string_count: 1, can_change_base_language: false,
  created_at: null, updated_at: null, translation_context: null,
}

beforeEach(() => {
  clearActiveJob()
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  vi.mocked(jobsApi.get).mockReset().mockResolvedValue({
    id: 'old-import', kind: 'import', status: 'running', result: null,
    error: null, created_at: null, completed_at: null, progress: null,
  })
  vi.mocked(syncApi.importFile).mockReset()
})

afterEach(() => clearActiveJob())

it('recovers expired imports after reload, checks again, and unlocks import on dismiss', async () => {
  rememberJob({
    jobId: 'old-import', projectId: 'proj-1', kind: 'import',
    pollingStartedAt: Date.now() - 31 * 60 * 1000,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { unmount } = render(
    <QueryClientProvider client={client}><ImportExportPage /></QueryClientProvider>,
  )
  try {
    expect(screen.getByText('Still running; the result is unknown.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Importing/ }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect(jobsApi.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(jobsApi.get).toHaveBeenCalledWith('old-import'))
    expect(getActiveJob()?.pollingPaused).toBe(false)
    // Simulate another expired window without waiting 30 minutes.
    act(() => rememberJob({ ...getActiveJob()!, pollingPaused: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(getActiveJob()).toBeNull()
    expect(sessionStorage.getItem('x-locale-active-job')).toBeNull()
    expect((screen.getByRole('button', { name: /Choose file/ }) as HTMLButtonElement).disabled)
      .toBe(false)
    expect(syncApi.importFile).not.toHaveBeenCalled()
  } finally {
    unmount()
    client.clear()
  }
})
