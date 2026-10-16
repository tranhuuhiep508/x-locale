import { isKnownTourId } from '@/lib/tours/ids'

export function toursSeenKey(userId: string): string {
  return `xl:tours-seen:${userId}`
}

/** True only when Playwright set the flag before the app loaded. Replay does not read this. */
export function e2eToursOff(): boolean {
  return window.__XL_E2E_TOURS_OFF__ === true
}

type SeenValue = string | number | string[]
type SeenMap = Record<string, SeenValue>

/** A timestamp means every step is seen. An array is the step targets seen so far. */
export type SeenProgress = 'all' | readonly string[]

function seenValue(value: unknown): SeenValue | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (!Array.isArray(value)) return undefined
  return value.filter((target): target is string => typeof target === 'string')
}

function readSeenMap(raw: string | null): SeenMap {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const seen: SeenMap = {}
    for (const [tourId, value] of Object.entries(parsed)) {
      const next = seenValue(value)
      if (next !== undefined) seen[tourId] = next
    }
    return seen
  } catch {
    return {}
  }
}

function writeSeenMap(storage: Storage, key: string, seen: SeenMap) {
  storage.setItem(key, JSON.stringify(seen))
}

export function isTourSeen(userId: string, tourId: string, storage?: Storage): boolean {
  return tourSeenProgress(userId, tourId, storage) === 'all'
}

/** Legacy timestamps stay fully seen. Missing and partial entries return the targets stored. */
export function tourSeenProgress(userId: string, tourId: string, storage?: Storage): SeenProgress {
  if (!userId || !isKnownTourId(tourId)) return []
  try {
    const value = readSeenMap((storage ?? localStorage).getItem(toursSeenKey(userId)))[tourId]
    if (typeof value === 'string' || typeof value === 'number') return 'all'
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/** Steps already shown in this page session. Kept when localStorage cannot be written. */
export function rememberSessionSteps(
  session: Partial<Record<string, readonly string[]>>,
  tourId: string,
  targets: readonly string[],
): Partial<Record<string, readonly string[]>> {
  if (targets.length === 0) return session
  const previous = session[tourId] ?? []
  return { ...session, [tourId]: [...new Set([...previous, ...targets])] }
}

/** Stored progress plus steps shown this session. A full entry stays full. */
export function mergeSeenProgress(
  stored: SeenProgress,
  sessionTargets: readonly string[],
): SeenProgress {
  if (stored === 'all') return 'all'
  if (sessionTargets.length === 0) return stored
  return [...new Set([...stored, ...sessionTargets])]
}

/** Remember the shown steps, then try to persist them. A storage failure leaves the session set. */
export function dismissTourSteps(
  session: Partial<Record<string, readonly string[]>>,
  userId: string,
  tourId: string,
  targets: readonly string[],
  roleTargets: readonly string[] = [],
  storage?: Storage,
): Partial<Record<string, readonly string[]>> {
  const next = rememberSessionSteps(session, tourId, targets)
  markStepsSeen(userId, tourId, targets, storage, roleTargets)
  return next
}

/**
 * Adds step targets for a known tour. A legacy full entry is left in place.
 * When the stored targets cover every role step, the entry becomes a timestamp.
 */
export function markStepsSeen(
  userId: string,
  tourId: string,
  targets: readonly string[],
  storage?: Storage,
  roleTargets: readonly string[] = [],
): void {
  if (!userId || !isKnownTourId(tourId) || targets.length === 0) return
  try {
    const store = storage ?? localStorage
    const key = toursSeenKey(userId)
    const seen = readSeenMap(store.getItem(key))
    const current = seen[tourId]
    if (typeof current === 'string' || typeof current === 'number') return
    const next = [...new Set([...(Array.isArray(current) ? current : []), ...targets])]
    const covered = roleTargets.length > 0 && roleTargets.every((target) => next.includes(target))
    if (covered) {
      markTourSeen(userId, tourId, store)
      return
    }
    seen[tourId] = next
    writeSeenMap(store, key, seen)
  } catch {
    // Private mode and disabled storage should not break the page.
  }
}

/** Records a known tour. Unknown ids and storage failures are ignored. Existing unknown keys are kept. */
export function markTourSeen(
  userId: string,
  tourId: string,
  storage?: Storage,
  seenAt: string | number = new Date().toISOString(),
): void {
  if (!userId || !isKnownTourId(tourId)) return
  if (typeof seenAt !== 'string' && typeof seenAt !== 'number') return
  try {
    const store = storage ?? localStorage
    const key = toursSeenKey(userId)
    const seen = readSeenMap(store.getItem(key))
    seen[tourId] = seenAt
    writeSeenMap(store, key, seen)
  } catch {
    // Private mode and disabled storage should not break the page.
  }
}
