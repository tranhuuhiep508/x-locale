import type { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { queryKeys } from '@/lib/query-keys'

export type ActiveJobKind = 'import' | 'add' | 'revert'

export type ActiveJob = {
  jobId: string
  projectId: string
  kind: ActiveJobKind
  dryRun?: boolean
  pollUntil: number
}

export const JOB_POLL_LIMIT_MS = 5 * 60 * 1000
const STORAGE_KEY = 'x-locale-active-job'

let current: ActiveJob | null = readStored()
const listeners = new Set<() => void>()
const claimed = new Set<string>()
let stoppedJobId: string | null = null

function readStored(): ActiveJob | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveJob
    if (!parsed?.jobId || !parsed.projectId || !parsed.kind) return null
    return { ...parsed, pollUntil: Number.isFinite(parsed.pollUntil) ? parsed.pollUntil : 0 }
  } catch {
    return null
  }
}

function publish(next: ActiveJob | null) {
  current = next
  for (const listener of listeners) listener()
}

/** Remember a background job so a later page, or a reload, can still finish it. */
export function rememberJob(input: Omit<ActiveJob, 'pollUntil'> & { pollUntil?: number }) {
  const job: ActiveJob = { ...input, pollUntil: input.pollUntil ?? Date.now() + JOB_POLL_LIMIT_MS }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(job))
  } catch {
    // Private mode can reject the write; the in-memory copy still covers this tab.
  }
  publish(job)
}

export function forgetJob(jobId: string) {
  if (readStored()?.jobId === jobId) {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // The in-memory copy is cleared below either way.
    }
  }
  if (current?.jobId === jobId) publish(null)
}

export function stopTrackingJob(jobId: string) {
  stoppedJobId = jobId
  forgetJob(jobId)
}

export function getStoppedJobId() {
  return stoppedJobId
}

/** First caller announces the result. Later callers still update their own screen. */
export function claimFinish(jobId: string): boolean {
  if (!jobId || claimed.has(jobId)) return false
  claimed.add(jobId)
  forgetJob(jobId)
  return true
}

export function clearActiveJob() {
  claimed.clear()
  stoppedJobId = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing else to clear.
  }
  publish(null)
}

export function subscribeActiveJob(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getActiveJob() {
  return current
}

export function useActiveJobId(projectId: string, kind: ActiveJobKind): string | null {
  const active = useSyncExternalStore(subscribeActiveJob, getActiveJob)
  if (active?.projectId === projectId && active.kind === kind) return active.jobId
  return null
}

export function refreshProjectContent(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
  void qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
  void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
  void qc.invalidateQueries({ queryKey: queryKeys.projects.modules(projectId) })
}

export function jobSuccessMessage(
  kind: ActiveJobKind,
  result: Record<string, unknown> | null,
): string {
  if (kind === 'revert') return `Restored ${Number(result?.reverted ?? 0)} strings`
  const created = Number(result?.created ?? 0)
  const updated = Number(result?.updated ?? 0)
  if (kind === 'add') return `Added ${created} · updated ${updated}`
  return `Import complete: ${created} created, ${updated} updated`
}
