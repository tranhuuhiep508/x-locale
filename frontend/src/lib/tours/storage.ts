import { isKnownTourId } from '@/lib/tours/ids'

export function toursSeenKey(userId: string): string {
  return `xl:tours-seen:${userId}`
}

type SeenMap = Record<string, string | number>

function readSeenMap(raw: string | null): SeenMap {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const seen: SeenMap = {}
    for (const [tourId, value] of Object.entries(parsed)) {
      if (typeof value === 'string' || typeof value === 'number') seen[tourId] = value
    }
    return seen
  } catch {
    return {}
  }
}

function writeSeenMap(storage: Storage, key: string, seen: SeenMap) {
  storage.setItem(key, JSON.stringify(seen))
}

export function isTourSeen(userId: string, tourId: string, storage: Storage = localStorage): boolean {
  if (!userId || !isKnownTourId(tourId)) return false
  try {
    const seen = readSeenMap(storage.getItem(toursSeenKey(userId)))
    const value = seen[tourId]
    return typeof value === 'string' || typeof value === 'number'
  } catch {
    return false
  }
}

/** Records a known tour. Unknown ids and storage failures are ignored. Existing unknown keys are kept. */
export function markTourSeen(
  userId: string,
  tourId: string,
  storage: Storage = localStorage,
  seenAt: string | number = new Date().toISOString(),
): void {
  if (!userId || !isKnownTourId(tourId)) return
  if (typeof seenAt !== 'string' && typeof seenAt !== 'number') return
  try {
    const key = toursSeenKey(userId)
    const seen = readSeenMap(storage.getItem(key))
    seen[tourId] = seenAt
    writeSeenMap(storage, key, seen)
  } catch {
    // Private mode and disabled storage should not break the page.
  }
}
