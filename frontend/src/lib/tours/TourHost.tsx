import { useEffect, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { TOUR_STEPS } from '@/lib/tours/definitions'
import { projectQuery, meQuery } from '@/lib/queries'
import { projectRefFromPath, screenForPath } from '@/lib/tours/screen'
import { e2eToursOff, markStepsSeen, tourSeenProgress } from '@/lib/tours/storage'
import { isTourTargetVisible, roleAllowsStep, selectTourSteps, stepsToStart } from '@/lib/tours/steps'
import { TourContext } from '@/lib/tours/tour-context'
import { loadTourDriver, startTour } from '@/lib/tours/run-tour'
import type { TourId } from '@/lib/tours/ids'

type Play = {
  screen: TourId
  mode: 'replay' | 'off'
} | null

function setTourStatus(status: 'pending' | 'idle' | 'running') {
  document.documentElement.dataset.tourStatus = status
}

function tourTargetSignature(): string {
  return [...document.querySelectorAll('[data-tour]')]
    .map((element) => element.getAttribute('data-tour') ?? '')
    .join('|')
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
  const [targetTick, setTargetTick] = useState(0)
  const [play, setPlay] = useState<Play>(null)
  const runningRef = useRef(false)
  const runId = useRef(0)
  const anchored = play?.screen === screen ? play : null
  const mode = anchored?.mode ?? 'auto'

  useEffect(() => {
    setDomReady(false)
    if (!screen) return
    const readySelector = `[data-tour-ready="${screen}"]`
    let signature = tourTargetSignature()
    const sync = () => {
      if (document.querySelector(readySelector)) setDomReady(true)
      const next = tourTargetSignature()
      if (next === signature) return
      signature = next
      if (!runningRef.current) setTargetTick((tick) => tick + 1)
    }
    if (document.querySelector(readySelector)) setDomReady(true)
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-tour', 'data-tour-ready'],
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

  useEffect(() => {
    if (!screen || !userId || !domReady || !roleReady) {
      if (screen) setTourStatus('pending')
      return
    }

    const roleTargets = TOUR_STEPS.filter(
      (step) => step.tourId === screen && roleAllowsStep(step, role),
    ).map((step) => step.target)
    const available = selectTourSteps(TOUR_STEPS, {
      tourId: screen,
      role,
      isTargetAvailable: isTourTargetVisible,
    })
    const nextTargets = stepsToStart({
      mode,
      toursOff: e2eToursOff(),
      running: false,
      seen: tourSeenProgress(userId, screen),
      roleTargets,
      available: available.map((step) => step.target),
    })
    if (nextTargets.length === 0) {
      setTourStatus('idle')
      return
    }

    const nextSteps = available.filter((step) => nextTargets.includes(step.target))
    const id = ++runId.current
    let handle: { destroy: () => void } | null = null
    runningRef.current = true
    setTourStatus('running')
    void loadTourDriver().then((driver) => {
      if (runId.current !== id) return
      handle = startTour(driver, nextSteps, () => {
        if (runId.current !== id) return
        markStepsSeen(userId, screen, nextTargets, localStorage, roleTargets)
        runningRef.current = false
        setPlay({ screen, mode: 'off' })
        setTargetTick((tick) => tick + 1)
      })
    })

    return () => {
      if (runId.current === id) runningRef.current = false
      runId.current += 1
      handle?.destroy()
    }
  }, [screen, userId, domReady, roleReady, role, mode, targetTick])

  return (
    <TourContext.Provider
      value={{
        canReplay,
        replay: () => {
          if (!screen || !canReplay) return
          setPlay({ screen, mode: 'replay' })
        },
      }}
    >
      {children}
    </TourContext.Provider>
  )
}
