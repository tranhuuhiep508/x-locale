import { createFileRoute } from '@tanstack/react-router'
import { StringsPage } from '@/features/strings/StringsPage'
import { stringsSearchSchema } from '@/lib/schemas'

export const Route = createFileRoute('/projects/$projectRef/strings')({
  validateSearch: (s: Record<string, unknown>) => stringsSearchSchema.parse(s),
  // Pending mutation callbacks must retain the project that submitted the write.
  remountDeps: ({ params }) => params.projectRef,
  component: StringsPage,
})
