import { useEffect } from 'react'
import { createFileRoute, Outlet, notFound, useRouterState } from '@tanstack/react-router'
import { AppHeader } from '@/components/layout/AppHeader'
import { AppShell } from '@/components/layout/AppShell'
import { ProjectSidebar } from '@/components/layout/ProjectSidebar'
import { ApiError } from '@/lib/api/client'
import { projectQuery } from '@/lib/queries'
import { useQuery } from '@tanstack/react-query'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'

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

function CloseMobileSidebarOnNavigate() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

  return null
}

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { data: project } = useQuery(projectQuery(projectId))

  if (!project) return null

  return (
    <SidebarProvider className="flex h-svh min-h-0 flex-col overflow-hidden">
      <CloseMobileSidebarOnNavigate />
      <AppHeader leading={<SidebarTrigger />} title={project.name} />
      <div className="flex min-h-0 flex-1">
        <ProjectSidebar project={project} />
        <SidebarInset className="min-h-0 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
