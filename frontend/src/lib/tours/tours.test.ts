import { describe, expect, it } from 'vitest'
import { TOUR_STEPS } from '@/lib/tours/definitions'
import { projectRefFromPath, screenForPath } from '@/lib/tours/screen'
import { isTourSeen, markTourSeen } from '@/lib/tours/storage'
import { selectTourSteps, tourCoversRoleSteps, type TourStep } from '@/lib/tours/steps'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, String(value))
    },
  }
}

const gated: TourStep[] = [
  { tourId: 'strings', target: 'grid', title: 'Keys', body: 'Each row is a string key.' },
  {
    tourId: 'strings',
    target: 'publish-toggle',
    title: 'Published',
    body: 'The Published switch makes your changes live.',
    roles: ['admin'],
  },
  {
    tourId: 'import',
    target: 'import-file',
    title: 'Import',
    body: 'Import a JSON or Excel file into a module.',
    roles: ['admin', 'editor'],
  },
]

describe('selectTourSteps', () => {
  const available = (missing: string[] = []) => (target: string) => !missing.includes(target)

  it('keeps an editor on shared steps and drops an admin-only step', () => {
    const visible = selectTourSteps(gated, {
      tourId: 'strings',
      role: 'editor',
      isTargetAvailable: available(),
    })
    expect(visible.map((step) => step.target)).toEqual(['grid'])
  })

  it('drops every role-gated step when the user has no matching role', () => {
    expect(
      selectTourSteps(gated, {
        tourId: 'import',
        role: null,
        isTargetAvailable: available(),
      }),
    ).toEqual([])
    expect(
      selectTourSteps(gated, {
        tourId: 'import',
        role: 'viewer',
        isTargetAvailable: available(),
      }),
    ).toEqual([])
  })

  it('keeps an import step for an editor and drops a missing target', () => {
    expect(
      selectTourSteps(gated, {
        tourId: 'import',
        role: 'editor',
        isTargetAvailable: available(),
      }).map((step) => step.target),
    ).toEqual(['import-file'])
    expect(
      selectTourSteps(gated, {
        tourId: 'import',
        role: 'admin',
        isTargetAvailable: available(['import-file']),
      }),
    ).toEqual([])
  })

  it('returns nothing for an unknown tour id', () => {
    expect(
      selectTourSteps(TOUR_STEPS, {
        tourId: 'activity',
        role: 'admin',
        isTargetAvailable: () => true,
      }),
    ).toEqual([])
  })
})

describe('screen tours', () => {
  it('maps each in-scope screen and ignores the rest', () => {
    expect(screenForPath('/')).toBe('projects')
    expect(screenForPath('/projects/new')).toBe('project-new')
    expect(screenForPath('/projects/demo-app/strings')).toBe('strings')
    expect(screenForPath('/projects/demo-app/import-export')).toBe('import')
    expect(screenForPath('/projects/demo-app/settings')).toBeNull()
    expect(screenForPath('/login')).toBeNull()
    expect(projectRefFromPath('/projects/demo-app/strings')).toBe('demo-app')
    expect(projectRefFromPath('/projects/new')).toBeNull()
  })

  it('uses the designer copy and gates import to admin and editor', () => {
    const body = (target: string) => TOUR_STEPS.find((step) => step.target === target)?.body
    expect(body('project-list')).toBe('Every project you belong to is listed here.')
    expect(body('cli-sync-hint')).toBe(
      'Sync strings from your code with the CLI. Set it up in Settings → API keys.',
    )
    expect(body('new-project')).toBe(
      "Anyone can create a project. You become its Admin. The next two steps are on the /projects/new page, which is a full page, not a dialog.",
    )
    expect(body('project-locales')).toBe(
      'Choose your source language and target languages. Admins can change them later in Settings.',
    )
    expect(body('project-context')).toBe(
      "Translation context (up to 500 characters) is added to the AI translation prompt, along with module context and each string's description.",
    )
    expect(body('string-open')).toBe(
      "Open a string to edit it. 'Save changes' saves a draft. It isn't live until you turn on Published.",
    )
    expect(body('search')).toBe(
      'Search matches keys, source text, and descriptions, but not translations.',
    )
    expect(body('sort')).toBe(
      'Sort by key, source text, status, or when and by whom a string was updated or created.',
    )
    expect(body('time-filter')).toBe(
      'Filter by the last hour, 24 hours, or 7 to 90 days, or choose a custom range.',
    )
    expect(body('import-format')).toBe(
      'JSON must use flat keys, for example "home.title": "Hello".',
    )
    expect(body('import-conflicts')).toBe(
      'Any conflict rejects the whole file. Nothing is written until every check passes.',
    )
    expect(body('import-lock')).toBe(
      "Only one import or CLI push can run per project at a time. If another is running, you'll see 'busy'. Try again shortly.",
    )
    expect(body('import-submit')).toBe('Each import appears in Activity as one batch you can undo.')

    const importSteps = TOUR_STEPS.filter((step) => step.tourId === 'import')
    expect(importSteps).toHaveLength(5)
    expect(importSteps.every((step) => step.roles?.includes('admin') && step.roles?.includes('editor'))).toBe(
      true,
    )
    expect(TOUR_STEPS.filter((step) => step.tourId === 'projects').every((step) => !step.roles)).toBe(true)
    expect(TOUR_STEPS.filter((step) => step.tourId === 'strings').every((step) => !step.roles)).toBe(true)
    expect(selectTourSteps(TOUR_STEPS, {
      tourId: 'import',
      role: 'editor',
      isTargetAvailable: () => true,
    })).toHaveLength(5)
    expect(selectTourSteps(TOUR_STEPS, {
      tourId: 'import',
      role: null,
      isTargetAvailable: () => true,
    })).toHaveLength(0)
  })

  it('does not mark a partial tour seen, and marks it once every role step was shown', () => {
    const storage = memoryStorage()
    const strings = TOUR_STEPS.filter((step) => step.tourId === 'strings')
    const finish = (present: string[], role = 'editor', extra: TourStep[] = []) => {
      const available = new Set(present)
      if (
        tourCoversRoleSteps([...strings, ...extra], {
          tourId: 'strings',
          role,
          isTargetAvailable: (target) => available.has(target),
        })
      ) {
        markTourSeen('user-a', 'strings', storage)
      }
    }

    finish(['search', 'time-filter'])
    expect(isTourSeen('user-a', 'strings', storage)).toBe(false)

    finish(strings.map((step) => step.target))
    expect(isTourSeen('user-a', 'strings', storage)).toBe(true)

    const adminOnly: TourStep = {
      tourId: 'strings',
      target: 'admin-only',
      title: 'Admin',
      body: 'Admin only.',
      roles: ['admin'],
    }
    const populated = strings.map((step) => step.target)
    const roleStorage = memoryStorage()
    const finishRole = (role: string) => {
      const available = new Set(populated)
      if (
        tourCoversRoleSteps([...strings, adminOnly], {
          tourId: 'strings',
          role,
          isTargetAvailable: (target) => available.has(target),
        })
      ) {
        markTourSeen(role, 'strings', roleStorage)
      }
    }
    finishRole('editor')
    expect(isTourSeen('editor', 'strings', roleStorage)).toBe(true)
    finishRole('admin')
    expect(isTourSeen('admin', 'strings', roleStorage)).toBe(false)
  })
})
