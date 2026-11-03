import { useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stringsApi } from '@/lib/api/strings'
import { jobsApi, jobError } from '@/lib/api/jobs'
import type { StringEntry, TranslateProposalItem } from '@/lib/api/types'
import type { QaBaseline } from '@/features/strings/qa-issues'
import { projectQuery } from '@/lib/queries'
import { refreshProjectContent } from '@/lib/active-job'
import {
  buildPublishPreview,
  isPublishFingerprintMismatch,
} from '@/features/strings/publish-preview'

import { buildBatchPublishItems, type BatchDraft } from './batch-publication'

type Draft = BatchDraft
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Operation failed. Please retry.'

export function useBatchWorkspace(projectRef: string, batchId: string) {
  const qc = useQueryClient()
  const key = ['cli-push-batch', projectRef, batchId] as const
  const { data: project } = useQuery(projectQuery(projectRef))
  const query = useQuery({
    queryKey: key,
    queryFn: () => stringsApi.cliPushBatch(projectRef, batchId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    staleTime: Infinity,
    gcTime: 0,
  })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const [qaBaselines, setQaBaselines] = useState<Record<string, QaBaseline>>({})
  const [action, setAction] = useState<'translate' | 'publish' | 'restart' | null>(null)
  const [published, setPublished] = useState(false)
  const [generationStarted, setGenerationStarted] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const requested = useRef(new Set<string>())
  const [started, setStarted] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [notice, setNotice] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
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
  const blocker = useBlocker({
    shouldBlockFn: () => started || Boolean(action),
    withResolver: true,
    enableBeforeUnload: started || Boolean(action),
  })

  function stage(items: TranslateProposalItem[]) {
    if (!mounted.current) return
    const members = new Map(query.data?.items.map((entry) => [entry.id, entry]))
    if (
      items.some(
        (item) =>
          !members.has(item.string_id) ||
          members.get(item.string_id)?.source_text !== item.source_text
      )
    ) {
      setError(
        'The source changed during translation. Restart the workflow to load the latest batch.'
      )
      setJobId(null)
      return
    }
    const currentDrafts = draftsRef.current
    const successful = items.flatMap((item) =>
      Object.entries(item.translations)
        .filter(
          ([locale, value]) =>
            requested.current.has(`${item.string_id}:${locale}`) &&
            value.trim() &&
            !currentDrafts[`${item.string_id}:${locale}`]
        )
        .map(([locale, value]) => ({ item, locale, value }))
    )
    const newDrafts = Object.fromEntries(
      successful.map(({ item, locale, value }) => [
        `${item.string_id}:${locale}`,
        { value, source: item.source_text, score: item.scores?.[locale] ?? null },
      ])
    )
    draftsRef.current = { ...currentDrafts, ...newDrafts }
    setDrafts((previous) => ({ ...previous, ...newDrafts }))
    setQaBaselines((previous) => ({
      ...previous,
      ...Object.fromEntries(
        successful.map(({ item, locale, value }) => [
          `${item.string_id}:${locale}`,
          { source: item.source_text, text: value, issues: item.issues?.[locale] },
        ])
      ),
    }))
    setJobId(null)
    const staged = new Set(successful.map(({ item, locale }) => `${item.string_id}:${locale}`))
    const remaining = [...requested.current].filter(
      (cell) => !currentDrafts[cell] && !staged.has(cell)
    ).length
    setNotice(
      remaining
        ? `${remaining} translations still need review. Retry unresolved translations or edit them manually.`
        : 'Translations are ready for review. Nothing is saved until Publish batch.'
    )
  }
  function edit(entry: StringEntry, locale: string, value: string) {
    if (operation.current || stale || !locales.includes(locale) || refreshError) return
    setStarted(true)
    setPublished(false)
    setNotice('')
    const next = { value, source: entry.source_text, score: null }
    draftsRef.current = {
      ...draftsRef.current,
      [`${entry.id}:${locale}`]: next,
    }
    setDrafts((previous) => ({
      ...previous,
      [`${entry.id}:${locale}`]: next,
    }))
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
      setJobId(null)
    } else if (result.status === 'completed') {
      handled.current = result.id
      const items = result.result?.items
      if (Array.isArray(items)) stage(items as TranslateProposalItem[])
      else {
        setError('The translation job returned no results. Retry translation.')
        setJobId(null)
      }
    }
    // Each completed proposal job is consumed once, only while this workflow is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data])

  const remaining = (query.data?.items ?? []).flatMap((entry) =>
    locales
      .filter((locale) => !drafts[`${entry.id}:${locale}`])
      .map((locale) => `${entry.id}:${locale}`)
  )
  const unresolved = generationStarted ? remaining : []
  async function translate() {
    if (
      operation.current ||
      !locales.length ||
      jobId ||
      refreshError ||
      stale ||
      !remaining.length
    )
      return
    requested.current = new Set(remaining)
    if (!requested.current.size) return
    setGenerationStarted(true)
    operation.current = true
    setAction('translate')
    setPublished(false)
    setStarted(true)
    setError('')
    setNotice('')
    try {
      const result = await stringsApi.translateProposals(projectRef, {
        scope: 'strings',
        batch_id: batchId,
        deleted: false,
        pending_delete: false,
        overwrite: true,
        locales,
        exclude_cells: Object.fromEntries(
          (query.data?.items ?? []).flatMap((entry) => {
            const excluded = locales.filter((locale) => Boolean(drafts[`${entry.id}:${locale}`]))
            return excluded.length ? [[entry.id, excluded]] : []
          })
        ),
      })
      if (!mounted.current) return
      if (result.job_id) setJobId(result.job_id)
      else stage(result.items)
    } catch (e) {
      if (mounted.current) setError(message(e))
    } finally {
      operation.current = false
      if (mounted.current) setAction(null)
    }
  }
  async function restart() {
    if (operation.current) return
    operation.current = true
    setAction('restart')
    draftsRef.current = {}
    setDrafts({})
    setQaBaselines({})
    setJobId(null)
    setPublished(false)
    setGenerationStarted(false)
    setRefreshError('')
    requested.current.clear()
    setStarted(false)
    setStale(true)
    setError('')
    setNotice('')
    try {
      const next = await stringsApi.cliPushBatch(projectRef, batchId)
      if (!mounted.current) return
      qc.setQueryData(key, next)
      setStale(false)
    } catch (e) {
      if (mounted.current) setError(message(e))
    } finally {
      operation.current = false
      if (mounted.current) setAction(null)
    }
  }
  async function refreshPublished() {
    try {
      const next = await stringsApi.cliPushBatch(projectRef, batchId)
      if (mounted.current) {
        qc.setQueryData(key, next)
        setRefreshError('')
      }
    } catch (e) {
      if (mounted.current)
        setRefreshError(`Batch published, but the review could not refresh. ${message(e)}`)
    }
  }
  async function publish() {
    const snapshot = query.data
    if (!snapshot || operation.current || jobId || stale || refreshError || unresolved.length)
      return
    operation.current = true
    setAction('publish')
    setError('')
    try {
      await stringsApi.publishCliPushBatch(projectRef, batchId, {
        fingerprint: snapshot.fingerprint,
        items: buildBatchPublishItems(snapshot.items, drafts),
      })
      draftsRef.current = {}
      setDrafts({})
      setQaBaselines({})
      setStarted(false)
      setPublished(true)
      setGenerationStarted(false)
      setNotice('Batch saved and published. Available on the next public pull or export.')
      refreshProjectContent(qc, projectRef)
      await refreshPublished()
    } catch (e) {
      if (isPublishFingerprintMismatch(e)) {
        setStale(true)
        setError(
          'The batch changed. Nothing was saved. Restart the workflow to review the latest content.'
        )
      } else setError(message(e))
    } finally {
      operation.current = false
      if (mounted.current) setAction(null)
    }
  }
  const items =
    query.data?.items.map((entry) => ({
      ...entry,
      translations: [...new Set([...entry.translations.map((t) => t.locale), ...locales])].map(
        (locale) => {
          const original = entry.translations.find((t) => t.locale === locale)
          const draft = drafts[`${entry.id}:${locale}`]
          return {
            id: original?.id ?? null,
            updated_at: original?.updated_at ?? null,
            locale,
            value: draft?.value ?? original?.value ?? '',
            published_value: original?.published_value ?? null,
            confidence: draft ? draft.score : (original?.confidence ?? null),
          }
        }
      ),
    })) ?? []
  return {
    project,
    query,
    batch: query.data ? { ...query.data, items } : undefined,
    locales,
    hasDrafts: Object.keys(drafts).length > 0,
    canTranslate: remaining.length > 0,
    unresolvedCount: unresolved.length,
    refreshError,
    refreshPublished,
    edit,
    busy: Boolean(action) || Boolean(jobId),
    publishing: action === 'publish',
    published,
    blocker,
    error,
    stale,
    progress:
      jobId || action === 'translate'
        ? 'Generating translations…'
        : action === 'publish'
          ? 'Saving and publishing batch…'
          : action === 'restart'
            ? 'Loading the latest batch…'
            : '',
    notice,
    started,
    qaBaselines,
    translate,
    publish,
    restart,
    job,
    stopJob: () => {
      handled.current = jobId
      setJobId(null)
      setNotice('Generation stopped in this workflow. Nothing was saved.')
    },
    preview: buildPublishPreview(items),
  }
}
