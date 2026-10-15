import { createContext, useContext } from 'react'

export type TourControls = {
  canReplay: boolean
  replay: () => void
}

export const TourContext = createContext<TourControls>({
  canReplay: false,
  replay: () => {},
})

export function useTourControls(): TourControls {
  return useContext(TourContext)
}
