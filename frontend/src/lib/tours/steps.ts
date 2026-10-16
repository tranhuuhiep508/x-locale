import type { TourId } from '@/lib/tours/ids'

export type TourRole = 'admin' | 'editor'

export type TourStep = {
  tourId: TourId
  target: string
  title: string
  body: string
  /** Omitted steps are shown to every role. A listed role must match exactly. */
  roles?: readonly TourRole[]
}

export function roleAllowsStep(step: TourStep, role: string | null): boolean {
  if (!step.roles) return true
  if (role !== 'admin' && role !== 'editor') return false
  return step.roles.includes(role)
}

/** True when every step this role can see is available. Other roles' steps do not count. */
export function tourCoversRoleSteps(
  steps: readonly TourStep[],
  options: {
    tourId: string
    role: string | null
    isTargetAvailable: (target: string) => boolean
  },
): boolean {
  const forRole = steps.filter(
    (step) => step.tourId === options.tourId && roleAllowsStep(step, options.role),
  )
  return forRole.length > 0 && forRole.every((step) => options.isTargetAvailable(step.target))
}

export function selectTourSteps(
  steps: readonly TourStep[],
  options: {
    tourId: string
    role: string | null
    isTargetAvailable: (target: string) => boolean
  },
): TourStep[] {
  return steps.filter((step) => {
    if (step.tourId !== options.tourId) return false
    if (!roleAllowsStep(step, options.role)) return false
    return options.isTargetAvailable(step.target)
  })
}

/**
 * Auto-start skips a seen screen and the e2e flag. Replay ignores both.
 * A dismissed partial tour starts again only when a target appears that was not shown.
 */
export function shouldStartTour(options: {
  mode: 'auto' | 'replay' | 'off'
  seen: boolean
  toursOff: boolean
  shown: readonly string[]
  current: readonly string[]
}): boolean {
  if (options.current.length === 0) return false
  if (options.mode === 'replay') return true
  if (options.toursOff || options.seen) return false
  if (options.mode === 'off') {
    const shown = new Set(options.shown)
    return options.current.some((target) => !shown.has(target))
  }
  return true
}

export function isTourTargetVisible(target: string): boolean {
  if (typeof document === 'undefined') return false
  const element = document.querySelector(`[data-tour="${CSS.escape(target)}"]`)
  if (!element) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}
