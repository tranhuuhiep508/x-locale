import { useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stringsApi } from '@/lib/api/strings'
import { jobsApi, jobError } from '@/lib/api/jobs'
import type { StringEntry, TranslateProposalItem } from '@/lib/api/types'
import type { QaBaseline } from '@/features/strings/qa-issues'
import { projectQuery } from '@/lib/queries'
import { refreshProjectContent } from '@/lib/active-job'
import { useToast } from '@/lib/toast'
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
  const toast = useToast()
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
  const [action, setAction] = useState<'translate' | 'publish' | 'draft' | 'restart' | null>(null)
  const [completion, setCompletion] = useState<'draft' | 'public' | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [generationStarted, setGenerationStarted] = useState(false)
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
  const shouldBlock = started || (Boolean(action) && completion === null)
  const blocker = useBlocker({
    shouldBlockFn: () => shouldBlock,
    withResolver: true,
    enableBeforeUnload: shouldBlock,
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
        : 'Translations are ready for review. Save as draft to keep reviewing, or publish when ready.'
    )
  }
  function edit(entry: StringEntry, locale: string, value: string) {
    if (operation.current || stale || !locales.includes(locale)) return
    setStarted(true)
    setCompletion(null)
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

  // CLI pushes regenerate every target; imports keep saved (pasted or reviewed) target values.
  const overwrite = query.data?.batch_kind === 'cli_push'
  const remaining = (query.data?.items ?? []).flatMap((entry) =>
    locales
      .filter(
        (locale) =>
          !drafts[`${entry.id}:${locale}`] &&
          (overwrite || !entry.translations.find((t) => t.locale === locale)?.value.trim())
      )
      .map((locale) => `${entry.id}:${locale}`)
  )
  const unresolved = generationStarted ? remaining : []
  async function translate() {
    if (operation.current || !locales.length || jobId || stale || !remaining.length) return
    requested.current = new Set(remaining)
    if (!requested.current.size) return
    setGenerationStarted(true)
    operation.current = true
    setAction('translate')
    setCompletion(null)
    setStarted(true)
    setError('')
    setNotice('')
    try {
      const result = await stringsApi.translateProposals(projectRef, {
        scope: 'strings',
        batch_id: batchId,
        deleted: false,
        pending_delete: false,
        overwrite,
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
    setCompletion(null)
    setGenerationStarted(false)
    requested.current.clear()
    setStarted(false)
    setStale(true)
    setError('')
    setRefreshError('')
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
  async function save(publish: boolean) {
    const snapshot = query.data
    if (!snapshot || operation.current || jobId || stale || (publish && unresolved.length)) return
    operation.current = true
    setAction(publish ? 'publish' : 'draft')
    setError('')
    try {
      const submit = publish ? stringsApi.publishCliPushBatch : stringsApi.saveCliPushBatch
      await submit(projectRef, batchId, {
        fingerprint: snapshot.fingerprint,
        items: buildBatchPublishItems(snapshot.items, drafts),
      })
      refreshProjectContent(qc, projectRef)
      if (!mounted.current) {
        toast.success(
          publish
            ? 'Batch saved and published. Available on the next public pull or export.'
            : 'Batch saved as draft. Public translations are unchanged.'
        )
        return
      }
      setStarted(false)
      setCompletion(publish ? 'public' : 'draft')
      setGenerationStarted(false)
      setNotice('')
      setStale(true)
      try {
        const next = await stringsApi.cliPushBatch(projectRef, batchId)
        if (!mounted.current) return
        qc.setQueryData(key, next)
        draftsRef.current = {}
        setDrafts({})
        setQaBaselines({})
        setStale(false)
      } catch (e) {
        if (mounted.current)
          setRefreshError(`Your changes were saved, but the batch could not refresh. ${message(e)}`)
      }
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
    hasTranslationChanges: (query.data?.items ?? []).some((entry) =>
      locales.some((locale) => {
        const draft = drafts[`${entry.id}:${locale}`]
        const saved = entry.translations.find((translation) => translation.locale === locale)
        return draft !== undefined && draft.value !== (saved?.value ?? '')
      })
    ),
    canTranslate: remaining.length > 0,
    unresolvedCount: unresolved.length,
    edit,
    busy: Boolean(action) || Boolean(jobId),
    publishing: action === 'publish',
    savingDraft: action === 'draft',
    published: completion === 'public',
    savedAsDraft: completion === 'draft',
    refreshError,
    blocker,
    error,
    stale,
    progress:
      jobId || action === 'translate'
        ? 'Generating translations…'
        : action === 'publish'
          ? 'Saving and publishing batch…'
          : action === 'draft'
            ? 'Saving batch as draft…'
            : action === 'restart'
              ? 'Loading the latest batch…'
              : '',
    notice,
    started,
    qaBaselines,
    translate,
    publish: () => save(true),
    saveDraft: () => save(false),
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
