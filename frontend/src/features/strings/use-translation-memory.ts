import { useCallback, useEffect, useRef, useState } from 'react'
import { stringsApi } from '@/lib/api/strings'
import type { TranslationMemoryResult } from '@/lib/api/types'

/** Debounce source edits and ignore responses from obsolete lookups. */
export function useTranslationMemory(
  projectId: string,
  source: string,
  locales: string[],
  stringId?: string,
  expectedSource?: string,
) {
  const localeKey = JSON.stringify(locales)
  const [state, setState] = useState<{
    source: string
    localeKey: string
    loading: boolean
    result?: TranslationMemoryResult
    error?: string
  }>({ source, localeKey, loading: false })
  const latest = useRef({ source, locales, localeKey, expectedSource })
  latest.current = { source, locales, localeKey, expectedSource }
  const generation = useRef(0)
  const load = useCallback(async (token: number) => {
    const input = latest.current
    if (!input.source.trim() || input.locales.length === 0) return
    if (token !== generation.current) return
    // A later keystroke keeps the last result on screen; only the first lookup skeletons.
    setState((prev) =>
      prev.result || prev.error
        ? prev
        : { source: input.source, localeKey: input.localeKey, loading: true },
    )
    try {
      const result = await stringsApi.translateMemory(projectId, {
        source_text: input.source,
        locales: input.locales,
        ...(stringId ? { string_id: stringId, expected_source_text: input.expectedSource } : {}),
      })
      if (
        token !== generation.current
        || latest.current.source !== input.source
        || latest.current.localeKey !== input.localeKey
      ) return
      setState({ source: input.source, localeKey: input.localeKey, loading: false, result })
    } catch (error) {
      if (
        token !== generation.current
        || latest.current.source !== input.source
        || latest.current.localeKey !== input.localeKey
      ) return
      setState({
        source: input.source,
        localeKey: input.localeKey,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load published translations.',
      })
    }
  }, [projectId, stringId])
  const initial = useRef(true)
  useEffect(() => {
    if (!source.trim() || latest.current.locales.length === 0) {
      generation.current += 1
      setState({ source, localeKey, loading: false })
      return
    }
    const token = ++generation.current
    const delay = initial.current ? 0 : 800
    initial.current = false
    setState((prev) =>
      prev.result || prev.error ? prev : { source, localeKey, loading: true },
    )
    if (delay === 0) {
      void load(token)
      return () => {
        if (generation.current === token) generation.current += 1
      }
    }
    const timer = setTimeout(() => {
      void load(token)
    }, delay)
    return () => {
      clearTimeout(timer)
      if (generation.current === token) generation.current += 1
    }
  }, [load, source, localeKey, expectedSource])
  const retry = useCallback(() => {
    const input = latest.current
    if (!input.source.trim() || input.locales.length === 0) return
    setState({ source: input.source, localeKey: input.localeKey, loading: true })
    void load(++generation.current)
  }, [load])
  // Previous matches stay visible, but they belong to the last request until this one lands.
  const stale = Boolean(state.result || state.error)
    && (state.source !== source || state.localeKey !== localeKey)
  return {
    matches: state.result?.matches ?? {},
    loading: state.loading,
    error: state.error,
    stale,
    retry,
  }
}
