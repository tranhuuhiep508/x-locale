import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stringsApi } from '@/lib/api/strings'
import { projectsApi } from '@/lib/api/projects'
import { queryKeys } from '@/lib/query-keys'
import { projectCoverageQuery, stringsQuery } from '@/lib/queries'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('stringsQuery', () => {
  it('recomputes relative time bounds when the cached query refetches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T10:00:00.000Z'))
    const list = vi.spyOn(stringsApi, 'list').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 50,
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const options = stringsQuery('project', {
      period: '1h',
      sort: 'updated_at',
      order: 'desc',
    })

    try {
      await client.fetchQuery(options)
      vi.setSystemTime(new Date('2026-10-04T10:30:00.000Z'))
      await client.refetchQueries({ queryKey: options.queryKey })

      expect(list).toHaveBeenCalledTimes(2)
      expect(list.mock.calls[0][1].since).toBe('2026-10-04T09:00:00.000Z')
      expect(list.mock.calls[1][1].since).toBe('2026-10-04T09:30:00.000Z')
      for (const [, params] of list.mock.calls) {
        expect(params.until).toBeUndefined()
        expect(params.period).toBeUndefined()
        expect(params.sort).toBe('updated_at')
        expect(params.order).toBe('desc')
      }
    } finally {
      client.clear()
    }
  })
})

describe('projectCoverageQuery', () => {
  it('refreshes coverage when catalog mutations invalidate string queries', async () => {
    const coverage = vi.spyOn(projectsApi, 'coverage').mockResolvedValue({ total: 0, locales: [] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    try {
      await client.fetchQuery(projectCoverageQuery('project'))
      await client.invalidateQueries({
        queryKey: queryKeys.projects.strings.all('project'),
        refetchType: 'all',
      })
      expect(coverage).toHaveBeenCalledTimes(2)
    } finally {
      client.clear()
    }
  })
})
