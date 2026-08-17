import { createFileRoute } from '@tanstack/react-router'
import { StringsPage } from '@/features/strings/StringsPage'
import { stringsSearchSchema } from '@/lib/schemas'

export const Route = createFileRoute('/projects/$projectId/strings')({
  validateSearch: (s: Record<string, unknown>) => stringsSearchSchema.parse(s),
  component: StringsPage,
})
