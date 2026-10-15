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

export function isTourTargetVisible(target: string): boolean {
  if (typeof document === 'undefined') return false
  const element = document.querySelector(`[data-tour="${CSS.escape(target)}"]`)
  if (!element) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}
