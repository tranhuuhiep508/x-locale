import { useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stringsApi } from '@/lib/api/strings'
import { jobsApi, jobError } from '@/lib/api/jobs'
import type { QaIssue, StringEntry, TranslateProposalItem } from '@/lib/api/types'
import { projectQuery } from '@/lib/queries'
import { refreshProjectContent } from '@/lib/active-job'
import {
  buildPublishPreview,
  isPublishFingerprintMismatch,
} from '@/features/strings/publish-preview'

type Edit = {
  stringId: string
  locale: string
  value: string
  original: string
  source: string
  error?: string
}
function reviewState(items: StringEntry[], skip: { stringId: string; locale: string }) {
  return JSON.stringify(
    items.map((e) => ({
      id: e.id,
      key: e.key,
      source: e.source_text,
      module: e.module_id,
      status: e.status,
      published: [e.published_key, e.published_module_id, e.published_source_text],
      editedLocalePublished:
        e.id === skip.stringId
          ? (e.translations.find((t) => t.locale === skip.locale)?.published_value ?? null)
          : null,
      translations: e.translations
        .filter((t) => !(e.id === skip.stringId && t.locale === skip.locale))
        .map((t) => [t.locale, t.value, t.published_value])
        .sort(),
    }))
  )
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Operation failed. Please retry.'

export function useBatchWorkspace(projectRef: string, batchId: string) {
  const qc = useQueryClient()
  const key = ['cli-push-batch', projectRef, batchId] as const
  const storageKey = `x-locale-batch-job:${projectRef}:${batchId}`
  const { data: project } = useQuery(projectQuery(projectRef))
  const query = useQuery({
    queryKey: key,
    queryFn: () => stringsApi.cliPushBatch(projectRef, batchId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 0,
  })
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [needsReview, setNeedsReview] = useState(false)
  const [progress, setProgress] = useState('')
  const [issues, setIssues] = useState<Record<string, QaIssue[]>>({})
  const [conflicted, setConflicted] = useState<string[]>([])
  const [remaining, setRemaining] = useState<TranslateProposalItem[]>([])
  const [jobId, setJobId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(storageKey)
    } catch {
      return null
    }
  })
  const handled = useRef<string | null>(null)
  const mounted = useRef(true)
  const operation = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const locales = (project?.target_languages ?? []).filter((l) => l !== project?.base_language)
  const chosen = (selected ?? locales).filter((l) => locales.includes(l))
  const dirty = Object.keys(edits).length > 0
  useBlocker({
    shouldBlockFn: () => (dirty || saving) && !window.confirm('Leave with unsaved translations?'),
    enableBeforeUnload: dirty || saving,
  })

  function rememberJob(id: string | null) {
    setJobId(id)
    try {
      if (id) sessionStorage.setItem(storageKey, id)
      else sessionStorage.removeItem(storageKey)
    } catch {
      /* Storage is optional. */
    }
  }
  async function reload() {
    const next = await stringsApi.cliPushBatch(projectRef, batchId)
    if (mounted.current) qc.setQueryData(key, next)
    refreshProjectContent(qc, projectRef)
    return next
  }
  function edit(entry: StringEntry, locale: string, value: string) {
    const id = `${entry.id}:${locale}`
    setNotice('')
    setEdits((previous) => {
      const original =
        previous[id]?.original ?? entry.translations.find((t) => t.locale === locale)?.value ?? ''
      const next = { ...previous }
      if (value === original && !previous[id]?.error) delete next[id]
      else
        next[id] = {
          stringId: entry.id,
          locale,
          value,
          original,
          source: previous[id]?.source ?? entry.source_text,
        }
      return next
    })
  }
  async function save(entry: StringEntry, locale: string) {
    const id = `${entry.id}:${locale}`,
      draft = edits[id]
    if (!draft || operation.current) return
    operation.current = true
    setSaving(true)
    try {
      const before = query.data?.items
      await stringsApi.update(projectRef, entry.id, {
        translations: { [locale]: draft.value },
        expected: { source_text: draft.source, translations: { [locale]: draft.original } },
      })
      setEdits((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      setIssues((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      const refreshed = await reload()
      if (before && reviewState(before, draft) !== reviewState(refreshed.items, draft))
        setError('Other values changed. Review the refreshed batch before publishing.')
      setNotice('Saved to working copy. Review the updated batch before publishing.')
    } catch (e) {
      setEdits((previous) => ({ ...previous, [id]: { ...draft, error: message(e) } }))
    } finally {
      operation.current = false
      if (mounted.current) setSaving(false)
    }
  }
  async function retryEdit(id: string) {
    const draft = edits[id]
    if (!draft || operation.current) return
    try {
      const refreshed = await reload()
      const current = refreshed.items.find((item) => item.id === draft.stringId)
      if (!current) throw new Error('String is no longer available in this batch.')
      setEdits((previous) => ({
        ...previous,
        [id]: {
          ...draft,
          original: current.translations.find((t) => t.locale === draft.locale)?.value ?? '',
          source: current.source_text,
          error: undefined,
        },
      }))
      setNeedsReview(false)
      setNotice('Latest source and baseline loaded. Review your text, then blur to retry saving.')
    } catch (e) {
      setError(message(e))
    }
  }

  async function apply(items: TranslateProposalItem[]) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    setConflicted([])
    setRemaining(items)
    setIssues((previous) => ({
      ...previous,
      ...Object.fromEntries(
        items.flatMap((item) =>
          Object.entries(item.issues ?? {}).map(([locale, findings]) => [
            `${item.string_id}:${locale}`,
            findings,
          ])
        )
      ),
    }))
    let pending = items
    try {
      while (pending.length && mounted.current) {
        const chunk = pending.slice(0, 100)
        setProgress(
          `Saving translations · ${items.length - pending.length} / ${items.length} strings`
        )
        await stringsApi.translateApply(projectRef, {
          overwrite: true,
          items: chunk.map((item) => ({
            string_id: item.string_id,
            expected_source_text: item.source_text,
            expected_translations: item.expected_translations,
            translations: item.translations,
            scores: item.scores,
          })),
        })
        pending = pending.slice(100)
        setRemaining(pending)
      }
      if (!mounted.current) return
      await reload()
      if (!pending.length) {
        rememberJob(null)
        setNotice(
          items.length
            ? 'Translations saved to working copy. Review all locales before publishing.'
            : 'No translations were generated. Existing working values were kept.'
        )
      }
    } catch (e) {
      setError(message(e))
      setRemaining(pending)
      const conflicts = (e as { body?: { detail?: { conflicts?: Array<{ string_id: string }> } } })
        .body?.detail?.conflicts
      setConflicted(conflicts?.map((item) => item.string_id) ?? [])
      try {
        await reload()
      } catch {
        /* Keep the last review snapshot on connection failure. */
      }
    } finally {
      operation.current = false
      if (mounted.current) {
        setBusy(false)
        setProgress('')
      }
    }
  }
  const job = useQuery({
    queryKey: ['batch-translation-job', jobId],
    queryFn: () => jobsApi.get(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (current) => {
      if (current.state.status === 'error') return false
      const status = current.state.data?.status
      return status === 'completed' || status === 'failed' ? false : 1000
    },
    retry: 2,
  })
  useEffect(() => {
    const result = job.data
    if (!result || handled.current === result.id) return
    if (result.status === 'failed') {
      handled.current = result.id
      setError(jobError(result).message)
      rememberJob(null)
    } else if (result.status === 'completed') {
      handled.current = result.id
      const items = result.result?.items
      if (Array.isArray(items)) void apply(items as TranslateProposalItem[])
      else {
        setError('The translation job returned no results. Retry translation.')
        rememberJob(null)
      }
    }
    // A completed job is claimed once; editing the workspace never reapplies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data])

  async function translate() {
    if (operation.current || !chosen.length || dirty || jobId) return
    operation.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setProgress('Generating translations…')
    try {
      const result = await stringsApi.translateProposals(projectRef, {
        scope: 'strings',
        batch_id: batchId,
        deleted: false,
        pending_delete: false,
        overwrite: true,
        locales: chosen,
      })
      if (!mounted.current) return
      operation.current = false
      if (result.job_id) rememberJob(result.job_id)
      else await apply(result.items)
    } catch (e) {
      setError(message(e))
    } finally {
      operation.current = false
      if (mounted.current) {
        setBusy(false)
        setProgress('')
      }
    }
  }
  async function publish() {
    const snapshot = query.data
    if (!snapshot || operation.current || dirty || jobId || remaining.length || needsReview) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      await stringsApi.batch(projectRef, {
        action: 'publish',
        fingerprint: snapshot.fingerprint,
        filter: { batch_id: batchId, deleted: false, pending_delete: false },
      })
      await reload()
      setNotice('Batch published. Available on the next public pull or export.')
    } catch (e) {
      if (isPublishFingerprintMismatch(e)) {
        setNeedsReview(true)
        try {
          await reload()
          setNeedsReview(false)
          setError('The working copy changed. Review the refreshed batch before publishing again.')
        } catch (refreshError) {
          setError(`The working copy changed. Could not refresh review: ${message(refreshError)}`)
        }
      } else setError(message(e))
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function refresh() {
    setError('')
    try {
      await reload()
      setNeedsReview(false)
      setNotice('Review refreshed. Your unsaved text is preserved.')
    } catch (e) {
      setError(message(e))
    }
  }
  const preview = buildPublishPreview(query.data?.items ?? [])
  return {
    project,
    query,
    edits,
    chosen,
    locales,
    setSelected,
    edit,
    save,
    retryEdit,
    dirty,
    busy: busy || Boolean(jobId && job.data?.status !== 'completed'),
    saving,
    error,
    notice,
    issues,
    conflicted,
    keepLatest: async () => {
      const unresolved = remaining.filter((item) => !conflicted.includes(item.string_id))
      setConflicted([])
      setRemaining(unresolved)
      if (unresolved.length) await apply(unresolved)
      else {
        rememberJob(null)
        setError('')
        await refresh()
        setNotice('Kept the latest translations for changed strings. Review before publishing.')
      }
    },
    progress: progress || (jobId ? 'Generating translations…' : ''),
    remaining,
    translate,
    retryApply: () => apply(remaining),
    publish,
    refresh,
    needsReview,
    stopJob: () => {
      handled.current = jobId
      rememberJob(null)
      setNotice('Stopped tracking. No results will be applied from this job.')
    },
    job,
    preview,
  }
}
