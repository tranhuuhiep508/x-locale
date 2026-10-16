/** Screen tours. `project-new` is the create-project screen of the projects guide. CLI steps live on Settings. */
export const TOUR_IDS = ['projects', 'project-new', 'strings', 'import', 'settings', 'activity'] as const

export type TourId = (typeof TOUR_IDS)[number]

export function isKnownTourId(tourId: string): tourId is TourId {
  return (TOUR_IDS as readonly string[]).includes(tourId)
}
