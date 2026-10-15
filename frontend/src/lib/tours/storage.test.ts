import { beforeEach, describe, expect, it } from 'vitest'
import { TOUR_IDS } from '@/lib/tours/ids'
import { isTourSeen, markTourSeen, toursSeenKey } from '@/lib/tours/storage'

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

describe('tour seen storage', () => {
  let storage: Storage

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('treats a missing key as unseen', () => {
    expect(isTourSeen('user-a', 'projects', storage)).toBe(false)
  })

  it('stores an ISO timestamp for a known tour and keeps it per user', () => {
    markTourSeen('user-a', 'projects', storage, '2026-10-15T12:00:00.000Z')
    expect(isTourSeen('user-a', 'projects', storage)).toBe(true)
    expect(isTourSeen('user-a', 'strings', storage)).toBe(false)
    expect(isTourSeen('user-b', 'projects', storage)).toBe(false)
    expect(JSON.parse(storage.getItem(toursSeenKey('user-a')) ?? '{}')).toEqual({
      projects: '2026-10-15T12:00:00.000Z',
    })
  })

  it('accepts a numeric timestamp already stored for a tour', () => {
    storage.setItem(toursSeenKey('user-a'), JSON.stringify({ strings: 1_710_000_000_000 }))
    expect(isTourSeen('user-a', 'strings', storage)).toBe(true)
  })

  it('ignores unknown tour ids on read and write', () => {
    storage.setItem(
      toursSeenKey('user-a'),
      JSON.stringify({ projects: '2026-10-15T12:00:00.000Z', 'not-a-tour': '2020-01-01T00:00:00.000Z' }),
    )
    expect(isTourSeen('user-a', 'not-a-tour', storage)).toBe(false)
    expect(isTourSeen('user-a', 'projects', storage)).toBe(true)
    markTourSeen('user-a', 'not-a-tour', storage)
    markTourSeen('user-a', 'import', storage, '2026-10-15T13:00:00.000Z')
    expect(JSON.parse(storage.getItem(toursSeenKey('user-a')) ?? '{}')).toEqual({
      projects: '2026-10-15T12:00:00.000Z',
      'not-a-tour': '2020-01-01T00:00:00.000Z',
      import: '2026-10-15T13:00:00.000Z',
    })
  })

  it('recovers from corrupt JSON and drops values that are not timestamps', () => {
    storage.setItem(toursSeenKey('user-a'), '{')
    expect(isTourSeen('user-a', 'projects', storage)).toBe(false)
    markTourSeen('user-a', 'strings', storage, '2026-10-15T12:00:00.000Z')
    expect(isTourSeen('user-a', 'strings', storage)).toBe(true)

    storage.setItem(
      toursSeenKey('user-a'),
      JSON.stringify({ projects: { at: 1 }, strings: true, import: null }),
    )
    for (const tourId of TOUR_IDS) {
      expect(isTourSeen('user-a', tourId, storage)).toBe(false)
    }
  })

  it('swallows storage failures', () => {
    const broken: Storage = {
      length: 0,
      clear: () => {},
      getItem: () => {
        throw new Error('blocked')
      },
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => markTourSeen('user-a', 'projects', broken)).not.toThrow()
    expect(isTourSeen('user-a', 'projects', broken)).toBe(false)
  })
})
