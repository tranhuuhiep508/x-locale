import type { Config } from 'driver.js'
import type { TourStep } from '@/lib/tours/steps'

export type TourHandle = {
  destroy: () => void
}

const SEEN_REASONS = new Set(['done', 'close', 'escape'])

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export async function loadTourDriver() {
  const { driver } = await import('driver.js')
  return driver
}

export function startTour(
  driver: Awaited<ReturnType<typeof loadTourDriver>>,
  steps: readonly TourStep[],
  onFinished: () => void,
): TourHandle {
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    onFinished()
  }

  const reduced = prefersReducedMotion()
  let active: ReturnType<typeof driver> | null = null
  const config: Config = {
    animate: !reduced,
    smoothScroll: !reduced,
    allowClose: true,
    overlayClickBehavior: 'none',
    overlayColor: '#000000',
    overlayOpacity: 0.5,
    stagePadding: 6,
    stageRadius: 8,
    popoverClass: 'xl-tour',
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    showButtons: ['next', 'previous', 'close'],
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    disableActiveInteraction: true,
    steps: steps.map((step) => ({
      element: `[data-tour="${CSS.escape(step.target)}"]`,
      popover: {
        title: step.title,
        description: step.body,
        side: 'bottom',
        align: 'start',
      },
    })),
    onPopoverRender: (popover) => {
      if (popover.footer.querySelector('[data-tour-skip]')) return
      const skip = document.createElement('button')
      skip.type = 'button'
      skip.dataset.tourSkip = 'true'
      skip.className = 'xl-tour-skip'
      skip.textContent = 'Skip tour'
      skip.addEventListener('click', () => {
        finish()
        active?.destroy()
      })
      popover.progress.insertAdjacentElement('afterend', skip)
    },
    onDestroyStarted: (_element, _step, { driver: activeDriver, reason }) => {
      if (reason && SEEN_REASONS.has(reason)) finish()
      activeDriver.destroy()
    },
  }

  active = driver(config)
  active.drive()
  return {
    destroy: () => active?.destroy(),
  }
}
