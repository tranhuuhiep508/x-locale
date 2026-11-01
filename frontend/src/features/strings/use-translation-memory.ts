import { useCallback, useEffect, useRef, useState } from 'react'
import { stringsApi } from '@/lib/api/strings'
import type { TranslationMemoryResult } from '@/lib/api/types'

/** Lookup on open or explicit request, never in response to typing. */
export function useTranslationMemory(
  projectId: string,
  source: string,
  locales: string[],
  stringId?: string,
  expectedSource?: string,
) {
  const [state, setState] = useState<{
    source: string
    loading: boolean
    result?: TranslationMemoryResult
    error?: string
  }>({ source, loading: false })
  const latest = useRef({ source, locales, expectedSource })
  latest.current = { source, locales, expectedSource }
  const generation = useRef(0)
  const load = useCallback(async () => {
    const input = latest.current
    if (!input.source.trim() || input.locales.length === 0) return
    const token = ++generation.current
    setState({ source: input.source, loading: true })
    try {
      const result = await stringsApi.translateMemory(projectId, {
        source_text: input.source,
        locales: input.locales,
        ...(stringId ? { string_id: stringId, expected_source_text: input.expectedSource } : {}),
      })
      if (token === generation.current && latest.current.source === input.source) {
        setState({ source: input.source, loading: false, result })
      }
    } catch (error) {
      if (token === generation.current && latest.current.source === input.source) {
        setState({
          source: input.source,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load published translations.',
        })
      }
    }
  }, [projectId, stringId])
  useEffect(() => {
    generation.current += 1
    setState({ source, loading: false })
  }, [source])
  useEffect(() => {
    void load()
    return () => {
      generation.current += 1
    }
  }, [load])
  const stale =
    state.source !== source ||
    (Boolean(source.trim()) && !state.result && !state.error && !state.loading)
  return {
    matches: stale ? {} : (state.result?.matches ?? {}),
    loading: !stale && state.loading,
    error: stale ? undefined : state.error,
    checked: !stale && (Boolean(state.result) || Boolean(state.error)),
    stale,
    load,
  }
}
