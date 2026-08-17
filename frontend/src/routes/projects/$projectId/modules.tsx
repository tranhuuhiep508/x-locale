import { createFileRoute } from '@tanstack/react-router'
import { ModulesPage } from '@/features/modules/ModulesPage'

export const Route = createFileRoute('/projects/$projectId/modules')({
  component: ModulesPage,
})
