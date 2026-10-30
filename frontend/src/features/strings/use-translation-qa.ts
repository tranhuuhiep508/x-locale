import { useEffect, useRef, useState } from 'react'
import { stringsApi } from '@/lib/api/strings'
import type { TranslationQAMap } from '@/lib/api/types'

export type QASeed = {
  source: string
  translations: Record<string, string>
  qa?: TranslationQAMap
}

export type QAStatus = 'unchecked' | 'checking' | 'checked' | 'unavailable'

export function qaSnapshot(source: string, translations: Record<string, string>): string {
  return JSON.stringify([source, Object.entries(translations).sort(([a], [b]) => a.localeCompare(b))])
}

/** Results belong to an input snapshot, never to a row ID alone. */
export function useTranslationQA(
  projectId: string,
  source: string,
  translations: Record<string, string>,
  seed?: QASeed,
  enabled = true,
) {
  const snapshot = qaSnapshot(source, translations)
  const [response, setResponse] = useState<{ snapshot: string; qa: TranslationQAMap; status: QAStatus }>()
  const latest = useRef(snapshot)
  const active = useRef(enabled)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  latest.current = snapshot
  active.current = enabled

  const seeded: TranslationQAMap = {}
  if (seed?.source === source) {
    for (const [locale, value] of Object.entries(translations)) {
      if (seed.translations[locale] === value && seed.qa?.[locale]) seeded[locale] = seed.qa[locale]
    }
  }
  const populated = Object.entries(translations).filter(([, value]) => value.trim())
  const hasText = Boolean(source.trim()) && populated.length > 0
  const seedComplete = populated.every(([locale]) => seeded[locale] != null)
  // Matching server results supersede a pending or failed draft check.
  const current = !seedComplete && response?.snapshot === snapshot ? response : undefined
  const qa = hasText ? current?.qa ?? seeded : {}
  const status: QAStatus = !hasText ? 'unchecked' : current?.status ?? (seedComplete ? 'checked' : 'checking')

  const sequence = useRef(0)
  const check = () => {
    clearTimeout(timer.current)
    if (!enabled || !hasText || pending.current === snapshot) return
    if (current?.status === 'checked' || (!current && seedComplete)) return
    pending.current = snapshot
    setResponse({ snapshot, qa: seeded, status: 'checking' })
    // A sequence token also rejects an old response after close/reopen or A → B → A.
    const request = ++sequence.current
    void stringsApi.translationQA(projectId, { source_text: source, translations }).then(
      (result) => {
        if (active.current && latest.current === snapshot && sequence.current === request) {
          setResponse({ snapshot, qa: result.qa, status: 'checked' })
        }
      },
      () => {
        if (active.current && latest.current === snapshot && sequence.current === request) {
          setResponse({ snapshot, qa: seeded, status: 'unavailable' })
        }
      },
    ).finally(() => {
      if (sequence.current === request) pending.current = null
    })
  }
  const checkRef = useRef(check)
  checkRef.current = check

  useEffect(() => {
    active.current = enabled
    // Changing snapshots invalidates in-flight work, including A → B → A edits.
    sequence.current += 1
    pending.current = null
    if (enabled && hasText && !seedComplete) {
      timer.current = setTimeout(() => checkRef.current(), 400)
    }
    return () => {
      clearTimeout(timer.current)
      sequence.current += 1
      pending.current = null
      active.current = false
    }
  }, [snapshot, projectId, enabled, hasText, seedComplete])

  return { qa, status, flush: () => checkRef.current() }
}
