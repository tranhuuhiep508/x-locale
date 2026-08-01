import { createFileRoute, Outlet, notFound } from '@tanstack/react-router'
import { AppShell } from '../../components/layout/AppShell'
import { ProjectSidebar } from '../../components/layout/ProjectSidebar'
import { api } from '../../lib/api/client'
import { ApiError } from '../../lib/api/client'
import type { Project } from '../../lib/api/types'
import { queryKeys } from '../../lib/query-keys'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/projects/$projectId')({
  loader: async ({ params, context }) => {
    try {
      return await context.queryClient.ensureQueryData({
        queryKey: queryKeys.project(params.projectId),
        queryFn: () => api.get<Project>(`/projects/${params.projectId}`),
        staleTime: 30 * 1000,
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw notFound()
      throw err
    }
  },
  component: ProjectLayout,
  notFoundComponent: () => (
    <AppShell>
      <div className="flex items-center justify-center h-64 text-slate-500">Project not found</div>
    </AppShell>
  ),
})

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { data: project } = useQuery<Project>({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
  })

  if (!project) return null

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-3.5rem)]">
        <ProjectSidebar project={project} />
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </AppShell>
  )
}
