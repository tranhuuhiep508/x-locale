import { createFileRoute } from '@tanstack/react-router'
import { ProjectOverviewPage } from '@/features/projects/ProjectOverviewPage'

export const Route = createFileRoute('/projects/$projectRef/')({
  component: ProjectOverviewPage,
})
