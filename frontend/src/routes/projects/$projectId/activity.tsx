import { createFileRoute } from '@tanstack/react-router'
import { ActivityPage } from '@/features/activity/ActivityPage'
import { activitySearchSchema } from '@/lib/schemas'

export const Route = createFileRoute('/projects/$projectId/activity')({
  validateSearch: (s: Record<string, unknown>) => activitySearchSchema.parse(s),
  component: ActivityPage,
})
