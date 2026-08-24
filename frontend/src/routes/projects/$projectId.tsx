import { createFileRoute, Outlet, notFound } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/AppShell'
import { ProjectSidebar } from '@/components/layout/ProjectSidebar'
import { ApiError } from '@/lib/api/client'
import { projectQuery } from '@/lib/queries'
import { useQuery } from '@tanstack/react-query'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

export const Route = createFileRoute('/projects/$projectId')({
  loader: async ({ params, context }) => {
    try {
      return await context.queryClient.ensureQueryData(projectQuery(params.projectId))
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw notFound()
      throw err
    }
  },
  component: ProjectLayout,
  notFoundComponent: () => (
    <AppShell>
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Project not found
      </div>
    </AppShell>
  ),
})

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { data: project } = useQuery(projectQuery(projectId))

  if (!project) return null

  return (
    <SidebarProvider>
      <ProjectSidebar project={project} />
      <SidebarInset>
        <header className="horizon-b flex h-14 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger />
          <span className="truncate font-medium md:hidden">{project.name}</span>
        </header>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
