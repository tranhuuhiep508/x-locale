import { type TourId } from '@/lib/tours/ids'

/** The tour for this pathname, or null when the screen has no tour. */
export function screenForPath(pathname: string): TourId | null {
  if (pathname === '/' || pathname === '/projects') return 'projects'
  if (pathname === '/projects/new') return 'project-new'
  const match = pathname.match(/^\/projects\/([^/]+)\/([^/]+)\/?$/)
  if (!match || match[1] === 'new') return null
  if (match[2] === 'strings') return 'strings'
  if (match[2] === 'import-export') return 'import'
  return null
}

/** Project slug for screens under `/projects/:ref`, ignoring the create page. */
export function projectRefFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/)
  if (!match || match[1] === 'new') return null
  return match[1]
}
