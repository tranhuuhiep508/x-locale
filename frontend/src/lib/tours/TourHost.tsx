import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { TOUR_STEPS } from '@/lib/tours/definitions'
import { projectQuery, meQuery } from '@/lib/queries'
import { projectRefFromPath, screenForPath } from '@/lib/tours/screen'
import { e2eToursOff, isTourSeen, markTourSeen } from '@/lib/tours/storage'
import { isTourTargetVisible, selectTourSteps, shouldStartTour, tourCoversRoleSteps } from '@/lib/tours/steps'
import { TourContext } from '@/lib/tours/tour-context'
import { loadTourDriver, startTour } from '@/lib/tours/run-tour'
import type { TourId } from '@/lib/tours/ids'

type Play = {
  screen: TourId
  mode: 'replay' | 'off'
  shown: readonly string[]
} | null

const NO_SHOWN: readonly string[] = []

function setTourStatus(status: 'pending' | 'idle' | 'running') {
  document.documentElement.dataset.tourStatus = status
}

export function TourHost({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const screen = screenForPath(pathname)
  const projectRef = projectRefFromPath(pathname)
  const { data: user } = useQuery({ ...meQuery(), enabled: screen != null })
  const project = useQuery({
    ...projectQuery(projectRef ?? ''),
    enabled: projectRef != null,
  })
  const userId = user?.id ?? null
  const role = project.data?.role ?? null
  const roleReady = projectRef == null || project.isSuccess
  const [domReady, setDomReady] = useState(false)
  const [play, setPlay] = useState<Play>(null)
  const anchored = play?.screen === screen ? play : null
  const mode = anchored?.mode ?? 'auto'
  const shown = anchored?.shown ?? NO_SHOWN

  useEffect(() => {
    setDomReady(false)
    if (!screen) return
    const selector = `[data-tour-ready="${screen}"]`
    if (document.querySelector(selector)) {
      setDomReady(true)
      return
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) setDomReady(true)
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-tour-ready'],
    })
    return () => observer.disconnect()
  }, [screen, pathname])

  const steps =
    screen && domReady && roleReady
      ? selectTourSteps(TOUR_STEPS, {
          tourId: screen,
          role,
          isTargetAvailable: isTourTargetVisible,
        })
      : []
  const canReplay = Boolean(userId && screen && steps.length > 0)
  const stepKey = steps.map((step) => step.target).join('|')
  const shownKey = shown.join('|')

  useEffect(() => {
    if (!screen || !userId || !domReady || !roleReady) {
      if (screen) setTourStatus('pending')
      return
    }
    const activeSteps = selectTourSteps(TOUR_STEPS, {
      tourId: screen,
      role,
      isTargetAvailable: isTourTargetVisible,
    })
    if (
      !shouldStartTour({
        mode,
        seen: isTourSeen(userId, screen),
        toursOff: e2eToursOff(),
        shown,
        current: activeSteps.map((step) => step.target),
      })
    ) {
      setTourStatus('idle')
      return
    }

    let cancelled = false
    let handle: { destroy: () => void } | null = null
    const markSeen = tourCoversRoleSteps(TOUR_STEPS, {
      tourId: screen,
      role,
      isTargetAvailable: isTourTargetVisible,
    })
    setTourStatus('running')
    void loadTourDriver().then((driver) => {
      if (cancelled) return
      handle = startTour(driver, activeSteps, () => {
        if (markSeen) markTourSeen(userId, screen)
        setPlay({ screen, mode: 'off', shown: activeSteps.map((step) => step.target) })
      })
    })

    return () => {
      cancelled = true
      handle?.destroy()
    }
  }, [screen, userId, domReady, roleReady, role, mode, stepKey, shownKey, shown])

  return (
    <TourContext.Provider
      value={{
        canReplay,
        replay: () => {
          if (!screen || !canReplay) return
          setPlay({ screen, mode: 'replay', shown: steps.map((step) => step.target) })
        },
      }}
    >
      {children}
    </TourContext.Provider>
  )
}
