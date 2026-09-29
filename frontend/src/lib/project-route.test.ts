import { describe, expect, it, vi } from 'vitest'
import { Route } from '@/routes/projects/$projectRef'
import { canonicalProjectHref } from './project-route'

describe('canonicalProjectHref', () => {
  it('preserves nested page, filters, and hash in legacy project links', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const pathname = `/projects/${uuid}/strings`
    expect(canonicalProjectHref(pathname, `${pathname}?q=login#row`, uuid, 'demo-app'))
      .toBe('/projects/demo-app/strings?q=login#row')
  })

  it('redirects a legacy UUID route and seeds the canonical project cache', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const pathname = `/projects/${uuid}/strings`
    const project = { id: uuid, slug: 'demo-app' }
    const queryClient = {
      ensureQueryData: async () => project,
      setQueryData: vi.fn(),
    }
    const loader = Route.options.loader as unknown as (args: {
      params: { projectRef: string }
      context: { queryClient: typeof queryClient }
      location: { pathname: string; href: string }
    }) => Promise<unknown>

    await expect(loader({
      params: { projectRef: uuid },
      context: { queryClient },
      location: { pathname, href: `${pathname}?q=login#row` },
    })).rejects.toMatchObject({
      options: { href: '/projects/demo-app/strings?q=login#row', replace: true },
    })
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ['projects', 'detail', 'demo-app'], project,
    )

    await expect(loader({
      params: { projectRef: 'demo-app' },
      context: { queryClient },
      location: { pathname: '/projects/demo-app', href: '/projects/demo-app' },
    })).resolves.toEqual(project)
  })
})
