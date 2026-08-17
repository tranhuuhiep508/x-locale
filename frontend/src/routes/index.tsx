import { createFileRoute } from '@tanstack/react-router'
import { ProjectListPage } from '@/features/projects/ProjectListPage'
import { projectsQuery } from '@/lib/queries'

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQuery()),
  component: ProjectListPage,
})
