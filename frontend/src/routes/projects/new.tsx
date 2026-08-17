import { createFileRoute } from '@tanstack/react-router'
import { NewProjectPage } from '@/features/projects/NewProjectPage'
import { languagesQuery } from '@/lib/queries'

export const Route = createFileRoute('/projects/new')({
  loader: ({ context }) => context.queryClient.ensureQueryData(languagesQuery()),
  component: NewProjectPage,
})
