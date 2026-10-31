import { useEffect, useRef, useState } from 'react'
import { stringsApi } from '@/lib/api/strings'
import type { QaIssue } from '@/lib/api/types'
import { QA_DEBOUNCE_MS, type QaBaseline, type QaView } from '@/features/strings/qa-issues'

export type QaWatchRow = {
  id: string
  locale: string
  source: string
  text: string
  baseline: QaBaseline
}

type QaCacheEntry = {
  token: string
  failed?: boolean
  issues?: QaIssue[]
  previous: QaIssue[]
}

export function qaToken(source: string, text: string): string {
  return `${source}\0${text}`
}

export function resolveQaView(row: QaWatchRow, cache: QaCacheEntry | undefined): QaView {
  if (!row.text.trim()) return { status: 'unchecked', issues: [], stale: false }
  const token = qaToken(row.source, row.text)
  const onBaseline = row.source === row.baseline.source && row.text === row.baseline.text
  if (onBaseline && row.baseline.issues !== undefined) {
    return { status: 'ready', issues: row.baseline.issues, stale: false }
  }
  if (cache?.token === token) {
    if (cache.failed) {
      return { status: 'failed', issues: cache.previous, stale: cache.previous.length > 0 }
    }
    return { status: 'ready', issues: cache.issues ?? [], stale: false }
  }
  if (onBaseline) return { status: 'unchecked', issues: [], stale: false }
  const previous = cache?.issues ?? cache?.previous ?? row.baseline.issues ?? []
  return { status: 'checking', issues: previous, stale: previous.length > 0 }
}

function rowSignature(rows: readonly QaWatchRow[]): string {
  return rows.map((row) => `${row.id}\t${row.locale}\t${row.source}\t${row.text}`).join('\n')
}

/**
 * Debounced read-only QA for translations the user is editing.
 * A matching baseline is shown as-is. Responses for an older text are ignored.
 */
export function useQaWatch(
  projectId: string,
  rows: readonly QaWatchRow[],
  enabled = true,
): Record<string, QaView> {
  const [cache, setCache] = useState<Record<string, QaCacheEntry>>({})
  const cacheRef = useRef(cache)
  cacheRef.current = cache
  const gen = useRef<Record<string, number>>({})
  const armed = useRef<Record<string, string>>({})
  const timers = useRef<Record<string, number>>({})
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const signature = rowSignature(rows)

  useEffect(() => {
    const timersRef = timers.current
    const armedRef = armed.current
    const genRef = gen.current
    return () => {
      for (const id of Object.keys(timersRef)) window.clearTimeout(timersRef[id])
      for (const id of Object.keys(timersRef)) delete timersRef[id]
      for (const id of Object.keys(armedRef)) {
        genRef[id] = (genRef[id] ?? 0) + 1
        delete armedRef[id]
      }
    }
  }, [])

  useEffect(() => {
    function disarm(id: string) {
      const timer = timers.current[id]
      if (timer) window.clearTimeout(timer)
      delete timers.current[id]
      delete armed.current[id]
      gen.current[id] = (gen.current[id] ?? 0) + 1
    }

    if (!enabled) {
      for (const id of Object.keys(armed.current)) disarm(id)
      return
    }

    function arm(row: QaWatchRow, token: string) {
      const existing = timers.current[row.id]
      if (existing) window.clearTimeout(existing)
      const n = (gen.current[row.id] ?? 0) + 1
      gen.current[row.id] = n
      armed.current[row.id] = token
      const cached = cacheRef.current[row.id]
      const previous = cached?.issues ?? cached?.previous ?? row.baseline.issues ?? []
      timers.current[row.id] = window.setTimeout(() => {
        delete timers.current[row.id]
        void stringsApi.translateQa(projectId, {
          source_text: row.source,
          translation: row.text,
          locale: row.locale,
        }).then((result) => {
          if (gen.current[row.id] !== n) return
          delete armed.current[row.id]
          const issues = Array.isArray(result.issues) ? result.issues : []
          const entry: QaCacheEntry = { token, issues, previous }
          cacheRef.current = { ...cacheRef.current, [row.id]: entry }
          setCache(cacheRef.current)
        }, () => {
          if (gen.current[row.id] !== n) return
          delete armed.current[row.id]
          const entry: QaCacheEntry = { token, failed: true, previous }
          cacheRef.current = { ...cacheRef.current, [row.id]: entry }
          setCache(cacheRef.current)
        })
      }, QA_DEBOUNCE_MS)
    }

    const seen = new Set<string>()
    for (const row of rowsRef.current) {
      seen.add(row.id)
      const token = qaToken(row.source, row.text)
      const onBaseline = row.source === row.baseline.source && row.text === row.baseline.text
      const cached = cacheRef.current[row.id]
      if (!row.text.trim() || onBaseline || cached?.token === token) {
        if (armed.current[row.id]) disarm(row.id)
        continue
      }
      if (armed.current[row.id] === token) continue
      arm(row, token)
    }
    for (const id of Object.keys(armed.current)) {
      if (!seen.has(id)) disarm(id)
    }
  }, [enabled, projectId, signature])

  const views: Record<string, QaView> = {}
  for (const row of rows) views[row.id] = resolveQaView(row, cache[row.id])
  return views
}
