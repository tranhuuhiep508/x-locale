/** Screen tours shipped in this pass. `project-new` is the create-project screen of the projects guide. */
export const TOUR_IDS = ['projects', 'project-new', 'strings', 'import'] as const

export type TourId = (typeof TOUR_IDS)[number]

export function isKnownTourId(tourId: string): tourId is TourId {
  return (TOUR_IDS as readonly string[]).includes(tourId)
}
