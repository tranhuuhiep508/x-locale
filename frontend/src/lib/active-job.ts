import type { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { queryKeys } from '@/lib/query-keys'

export type ActiveJobKind = 'import' | 'add' | 'revert'

export type ActiveJob = {
  jobId: string
  projectId: string
  kind: ActiveJobKind
  dryRun?: boolean
  pollingStartedAt: number
  pollingPaused: boolean
}

const STORAGE_KEY = 'x-locale-active-job'
export const JOB_POLL_TIMEOUT_MS = 30 * 60 * 1000

let current: ActiveJob | null = readStored()
const listeners = new Set<() => void>()
const claimed = new Set<string>()
let deadlineTimer: ReturnType<typeof setTimeout> | undefined

function readStored(): ActiveJob | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveJob
    if (!parsed?.jobId || !parsed.projectId || !parsed.kind) return null
    if (!Number.isFinite(parsed.pollingStartedAt)) {
      parsed.pollingStartedAt = Date.now()
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
      } catch {
        // A readable legacy job still works when storage rejects writes.
      }
    }
    parsed.pollingPaused = Boolean(parsed.pollingPaused) ||
      Date.now() >= parsed.pollingStartedAt + JOB_POLL_TIMEOUT_MS
    return parsed
  } catch {
    return null
  }
}

function publish(next: ActiveJob | null) {
  current = next
  scheduleDeadline()
  for (const listener of listeners) listener()
}

function scheduleDeadline() {
  clearTimeout(deadlineTimer)
  if (!current || current.pollingPaused) return
  const jobId = current.jobId
  deadlineTimer = setTimeout(() => {
    if (current?.jobId === jobId) rememberJob({ ...current, pollingPaused: true })
  }, Math.max(0, current.pollingStartedAt + JOB_POLL_TIMEOUT_MS - Date.now()))
}

scheduleDeadline()

/** Remember a background job so a later page, or a reload, can still finish it. */
export function rememberJob(
  job: Omit<ActiveJob, 'pollingStartedAt' | 'pollingPaused'> &
    Partial<Pick<ActiveJob, 'pollingStartedAt' | 'pollingPaused'>>,
) {
  const tracked: ActiveJob = {
    ...job,
    pollingStartedAt: job.pollingStartedAt ?? Date.now(),
    pollingPaused: job.pollingPaused ?? false,
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tracked))
  } catch {
    // Private mode can reject the write; the in-memory copy still covers this tab.
  }
  publish(tracked)
}

export function resumeJobPolling(jobId: string) {
  if (current?.jobId !== jobId) return
  rememberJob({ ...current, pollingStartedAt: Date.now(), pollingPaused: false })
}

export function isJobPollingPaused(jobId: string | null) {
  return Boolean(current && current.jobId === jobId &&
    (current.pollingPaused || Date.now() >= current.pollingStartedAt + JOB_POLL_TIMEOUT_MS))
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

/** First caller announces the result. Later callers still update their own screen. */
export function claimFinish(jobId: string): boolean {
  if (!jobId || claimed.has(jobId)) return false
  claimed.add(jobId)
  forgetJob(jobId)
  return true
}

export function clearActiveJob() {
  claimed.clear()
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
