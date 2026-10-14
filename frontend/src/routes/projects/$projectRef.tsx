import { useEffect, useSyncExternalStore } from 'react'
import { createFileRoute, Outlet, notFound, redirect, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AppHeader } from '@/components/layout/AppHeader'
import { AppShell } from '@/components/layout/AppShell'
import { ProjectSidebar } from '@/components/layout/ProjectSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useJob } from '@/hooks/use-job'
import {
  claimFinish,
  getActiveJob,
  jobSuccessMessage,
  refreshProjectContent,
  subscribeActiveJob,
} from '@/lib/active-job'
import { ApiError } from '@/lib/api/client'
import { canonicalProjectHref } from '@/lib/project-route'
import { projectQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast'

export const Route = createFileRoute('/projects/$projectRef')({
  loader: async ({ params, context, location }) => {
    try {
      const project = await context.queryClient.ensureQueryData(projectQuery(params.projectRef))
      if (params.projectRef !== project.slug) {
        context.queryClient.setQueryData(queryKeys.projects.detail(project.slug), project)
        throw redirect({
          href: canonicalProjectHref(location.pathname, location.href, params.projectRef, project.slug),
          replace: true,
        })
      }
      return project
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

function ProjectJobWatcher() {
  const active = useSyncExternalStore(subscribeActiveJob, getActiveJob)
  const qc = useQueryClient()
  const toast = useToast()
  useJob(active?.jobId ?? null, {
    onCompleted: (job) => {
      if (!active || !claimFinish(job.id)) return
      if (active.dryRun || job.result?.dry_run === true) return
      refreshProjectContent(qc, active.projectId)
      toast.success(jobSuccessMessage(active.kind, job.result))
    },
    onFailed: (error) => {
      if (!active || !claimFinish(active.jobId)) return
      toast.error(error.message)
    },
  })
  return null
}

function ProjectLayout() {
  const { projectRef } = Route.useParams()
  const { data: project } = useQuery(projectQuery(projectRef))

  if (!project) return null

  return (
    <SidebarProvider className="flex h-svh min-h-0 flex-col overflow-hidden">
      <ProjectJobWatcher />
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
