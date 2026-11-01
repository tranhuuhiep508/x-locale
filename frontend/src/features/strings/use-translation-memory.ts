import { useCallback, useEffect, useRef, useState } from 'react'
import { stringsApi } from '@/lib/api/strings'
import type { TranslationMemoryResult } from '@/lib/api/types'

/** Debounce source edits and ignore responses from obsolete lookups. */
export function useTranslationMemory(
  projectId: string,
  source: string,
  locales: string[],
  stringId?: string,
  expectedSource?: string
) {
  const localeKey = JSON.stringify(locales)
  const [state, setState] = useState<{
    result?: TranslationMemoryResult
    error?: string
  }>({})
  const latest = useRef({ source, locales, expectedSource })
  latest.current = { source, locales, expectedSource }
  const generation = useRef(0)
  const load = useCallback(async () => {
    const input = latest.current
    if (!input.source.trim() || input.locales.length === 0) return
    const token = ++generation.current
    setState((prev) => ({ result: prev.result }))
    try {
      const result = await stringsApi.translateMemory(projectId, {
        source_text: input.source,
        locales: input.locales,
        ...(stringId ? { string_id: stringId, expected_source_text: input.expectedSource } : {}),
      })
      if (token === generation.current && latest.current.source === input.source) {
        setState({ result })
      }
    } catch (error) {
      if (token === generation.current && latest.current.source === input.source) {
        setState({
          error: error instanceof Error ? error.message : 'Could not load published translations.',
        })
      }
    }
  }, [projectId, stringId])
  const initial = useRef(true)
  useEffect(() => {
    generation.current += 1
    setState((prev) => ({ result: source.trim() ? prev.result : undefined }))
    if (initial.current) {
      initial.current = false
      void load()
    } else {
      const timer = setTimeout(() => {
        void load()
      }, 350)
      return () => {
        clearTimeout(timer)
        generation.current += 1
      }
    }
    return () => {
      generation.current += 1
    }
  }, [load, source, localeKey, expectedSource])
  return {
    matches: state.result?.matches ?? {},
    loading: Boolean(source.trim() && locales.length) && !state.result && !state.error,
    error: state.error,
  }
}
