import { describe, expect, it } from 'vitest'
import { TOUR_STEPS } from '@/lib/tours/definitions'
import { projectRefFromPath, screenForPath } from '@/lib/tours/screen'
import { isTourSeen, markStepsSeen } from '@/lib/tours/storage'
import { roleAllowsStep, selectTourSteps, stepsToStart, tourCoversRoleSteps, type TourStep } from '@/lib/tours/steps'

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
        tourId: 'cms',
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
    expect(screenForPath('/projects/demo-app/settings')).toBe('settings')
    expect(screenForPath('/projects/demo-app/activity')).toBe('activity')
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

  it('filters settings and activity steps by role, and keeps an empty activity list unseen', () => {
    const body = (target: string) => TOUR_STEPS.find((step) => step.target === target)?.body
    expect(body('settings-general')).toBe('Name, base language, layout, and target languages.')
    expect(body('dup-keys')).toBe(
      "Allow duplicate keys across modules. You can't turn this off while duplicates exist.",
    )
    expect(body('settings-context')).toBe('Translation context for AI translation.')
    expect(body('members')).toBe(
      'Add or remove members and change roles. Admins manage members and settings. Editors do all string work.',
    )
    expect(body('member-remove')).toBe(
      "Removing a member isn't logged and can't be undone. A project always needs at least one Admin.",
    )
    expect(body('api-keys')).toBe('Generate a personal API key here. Generating a new one revokes your old key.')
    expect(body('loc-init')).toBe('Run <code>loc init -k &lt;your key&gt;</code> in your repo.')
    expect(body('loc-push')).toBe(
      '<code>loc push</code> sends base-language strings that changed since your last push (<code>--full</code> sends all of them). It creates and updates keys but never deletes them.',
    )
    expect(body('push-limits')).toBe(
      "A push is rejected if a key is queued for deletion or already deleted, or if the base language doesn't match. Pushes of more than 5,000 keys run in the background.",
    )
    expect(body('activity-list')).toBe('Every string and translation change is listed here.')
    expect(body('batch-undo')).toBe(
      "Imports, AI translations, and batch actions can each be undone as a whole batch. An undo can't itself be undone.",
    )
    expect(body('string-history')).toBe(
      'To revert a single string, open its History and restore an earlier version.',
    )
    expect(body('restore-limits')).toBe(
      "History can't restore publish or unpublish actions or deletes. To bring back a deleted string, use the Deleted filter and choose Restore.",
    )

    const present = () => true
    const settings = (role: string | null) =>
      selectTourSteps(TOUR_STEPS, { tourId: 'settings', role, isTargetAvailable: present }).map(
        (step) => step.target,
      )
    const editorSettings = [
      'settings-general',
      'dup-keys',
      'settings-context',
      'api-keys',
      'loc-init',
      'loc-push',
      'push-limits',
    ]
    expect(settings('editor')).toEqual(editorSettings)
    expect(settings(null)).toEqual(editorSettings)
    expect(settings('admin')).toEqual([
      'settings-general',
      'dup-keys',
      'settings-context',
      'members',
      'member-remove',
      'api-keys',
      'loc-init',
      'loc-push',
      'push-limits',
    ])

    const activityTargets = ['activity-list', 'batch-undo', 'string-history', 'restore-limits']
    const activity = (role: string | null, targets: string[]) =>
      selectTourSteps(TOUR_STEPS, {
        tourId: 'activity',
        role,
        isTargetAvailable: (target) => targets.includes(target),
      }).map((step) => step.target)
    expect(activity('editor', activityTargets)).toEqual(activityTargets)
    expect(activity('admin', activityTargets)).toEqual(activityTargets)
    expect(activity(null, activityTargets)).toEqual(['activity-list', 'string-history', 'restore-limits'])

    const hints = ['batch-undo', 'string-history', 'restore-limits']
    const covers = (role: string, targets: string[]) =>
      tourCoversRoleSteps(TOUR_STEPS, {
        tourId: 'activity',
        role,
        isTargetAvailable: (target) => targets.includes(target),
      })
    expect(covers('editor', hints)).toBe(false)
    expect(covers('editor', activityTargets)).toBe(true)
  })

  it('stores partial steps without marking the screen fully seen', () => {
    const storage = memoryStorage()
    const strings = TOUR_STEPS.filter((step) => step.tourId === 'strings')
    const roleTargets = (role: string, extra: TourStep[] = []) =>
      [...strings, ...extra]
        .filter((step) => roleAllowsStep(step, role))
        .map((step) => step.target)

    markStepsSeen('user-a', 'strings', ['search', 'time-filter'], storage, roleTargets('editor'))
    expect(isTourSeen('user-a', 'strings', storage)).toBe(false)

    markStepsSeen('user-a', 'strings', strings.map((step) => step.target), storage, roleTargets('editor'))
    expect(isTourSeen('user-a', 'strings', storage)).toBe(true)

    const adminOnly: TourStep = {
      tourId: 'strings',
      target: 'admin-only',
      title: 'Admin',
      body: 'Admin only.',
      roles: ['admin'],
    }
    const roleStorage = memoryStorage()
    const populated = strings.map((step) => step.target)
    markStepsSeen('editor', 'strings', populated, roleStorage, roleTargets('editor', [adminOnly]))
    expect(isTourSeen('editor', 'strings', roleStorage)).toBe(true)
    markStepsSeen('admin', 'strings', populated, roleStorage, roleTargets('admin', [adminOnly]))
    expect(isTourSeen('admin', 'strings', roleStorage)).toBe(false)
  })
})

describe('stepsToStart', () => {
  const hints = ['batch-undo', 'string-history', 'restore-limits']
  const roleTargets = ['activity-list', ...hints]
  const base = {
    toursOff: false,
    running: false,
    roleTargets,
  }

  it('plays only the new steps when an empty page becomes populated', () => {
    expect(stepsToStart({ ...base, mode: 'auto', seen: [], available: hints })).toEqual(hints)
    expect(stepsToStart({ ...base, mode: 'off', seen: hints, available: roleTargets })).toEqual(['activity-list'])
  })

  it('shows nothing new when an empty page is reloaded', () => {
    expect(stepsToStart({ ...base, mode: 'auto', seen: hints, available: hints })).toEqual([])
  })

  it('does nothing when targets shrink', () => {
    expect(stepsToStart({ ...base, mode: 'off', seen: roleTargets, available: hints })).toEqual([])
    expect(stepsToStart({ ...base, mode: 'off', seen: 'all', available: roleTargets })).toEqual([])
  })

  it('replay plays every available step and ignores the e2e flag', () => {
    expect(
      stepsToStart({
        mode: 'replay',
        toursOff: true,
        running: true,
        seen: 'all',
        roleTargets,
        available: roleTargets,
      }),
    ).toEqual(roleTargets)
  })

  it('respects a legacy full-screen entry', () => {
    expect(stepsToStart({ ...base, mode: 'auto', seen: 'all', available: roleTargets })).toEqual([])
  })

  it('auto-starts a step that appears during the visit, and waits while a tour is running', () => {
    expect(stepsToStart({ ...base, mode: 'off', running: true, seen: hints, available: roleTargets })).toEqual([])
    expect(stepsToStart({ ...base, mode: 'off', seen: hints, available: roleTargets })).toEqual(['activity-list'])
  })
})
