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

type Draft = { value: string; score: number | null; source: string }
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
  const [qaBaselines, setQaBaselines] = useState<Record<string, QaBaseline>>({})
  const [action, setAction] = useState<'translate' | 'publish' | null>(null)
  const [published, setPublished] = useState(false)
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
    setDrafts((previous) => ({
      ...previous,
      ...Object.fromEntries(
        items.flatMap((item) =>
          Object.entries(item.translations).map(([locale, value]) => [
            `${item.string_id}:${locale}`,
            { value, source: item.source_text, score: item.scores?.[locale] ?? null },
          ])
        )
      ),
    }))
    setQaBaselines((previous) => ({
      ...previous,
      ...Object.fromEntries(
        items.flatMap((item) =>
          Object.entries(item.translations).map(([locale, text]) => [
            `${item.string_id}:${locale}`,
            { source: item.source_text, text, issues: item.issues?.[locale] },
          ])
        )
      ),
    }))
    setJobId(null)
    setNotice('Translations are ready for review. Nothing is saved until Publish batch.')
  }
  function edit(entry: StringEntry, locale: string, value: string) {
    setStarted(true)
    setPublished(false)
    setNotice('')
    setDrafts((previous) => ({
      ...previous,
      [`${entry.id}:${locale}`]: { value, source: entry.source_text, score: null },
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

  async function translate() {
    if (operation.current || !locales.length || jobId || Object.keys(drafts).length) return
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
    setDrafts({})
    setQaBaselines({})
    setJobId(null)
    setPublished(false)
    setStarted(false)
    setStale(false)
    setError('')
    setNotice('')
    try {
      const next = await stringsApi.cliPushBatch(projectRef, batchId)
      qc.setQueryData(key, next)
    } catch (e) {
      setError(message(e))
    }
  }
  async function publish() {
    const snapshot = query.data
    if (!snapshot || operation.current || jobId || stale) return
    operation.current = true
    setAction('publish')
    setError('')
    try {
      await stringsApi.publishCliPushBatch(projectRef, batchId, {
        fingerprint: snapshot.fingerprint,
        items: snapshot.items.flatMap((entry) => {
          const changes = Object.entries(drafts).filter(([id]) => id.startsWith(`${entry.id}:`))
          if (!changes.length) return []
          return [
            {
              string_id: entry.id,
              expected_source_text: changes[0][1].source,
              translations: Object.fromEntries(
                changes.map(([id, draft]) => [id.slice(entry.id.length + 1), draft.value])
              ),
              scores: Object.fromEntries(
                changes.map(([id, draft]) => [id.slice(entry.id.length + 1), draft.score])
              ),
            },
          ]
        }),
      })
      setDrafts({})
      setQaBaselines({})
      setStarted(false)
      setPublished(true)
      setNotice('Batch saved and published. Available on the next public pull or export.')
      refreshProjectContent(qc, projectRef)
      const next = await stringsApi.cliPushBatch(projectRef, batchId)
      if (mounted.current) qc.setQueryData(key, next)
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
