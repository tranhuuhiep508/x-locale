import { useEffect } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  AlignLeft,
  ArrowLeft,
  ArrowUpDown,
  Boxes,
  LayoutDashboard,
  Settings,
  Tags,
} from 'lucide-react'
import type { Project } from '@/lib/api/types'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'

function CloseMobileSidebarOnNavigate() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { isMobile, setOpenMobile } = useSidebar()

  useEffect(() => {
    if (isMobile) setOpenMobile(false)
  }, [pathname, isMobile, setOpenMobile])

  return null
}

function isProjectPath(pathname: string, projectId: string, suffix: string, exact = false) {
  const href = `/projects/${projectId}${suffix}`
  return exact
    ? pathname === href || pathname === `${href}/`
    : pathname === href || pathname.startsWith(`${href}/`)
}

interface ProjectSidebarProps {
  project: Project
}

export function ProjectSidebar({ project }: ProjectSidebarProps) {
  const id = project.id
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <Sidebar collapsible="icon">
      <CloseMobileSidebarOnNavigate />
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="All projects">
              <Link to="/">
                <ArrowLeft />
                <span>All projects</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
          <p className="eyebrow">Project</p>
          <h2 className="mt-1 truncate font-heading text-base font-medium" title={project.name}>
            {project.name}
          </h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {project.slug}
          </p>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, id, '', true)}
                  tooltip="Overview"
                >
                  <Link to="/projects/$projectId" params={{ projectId: id }}>
                    <LayoutDashboard />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, id, '/strings')}
                  tooltip="Strings"
                >
                  <Link to="/projects/$projectId/strings" params={{ projectId: id }} search={{}}>
                    <AlignLeft />
                    <span>Strings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, id, '/modules')}
                  tooltip="Modules"
                >
                  <Link to="/projects/$projectId/modules" params={{ projectId: id }}>
                    <Boxes />
                    <span>Modules</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, id, '/tags')}
                  tooltip="Tags"
                >
                  <Link to="/projects/$projectId/tags" params={{ projectId: id }}>
                    <Tags />
                    <span>Tags</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, id, '/settings')}
                  tooltip="Settings"
                >
                  <Link to="/projects/$projectId/settings" params={{ projectId: id }}>
                    <Settings />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, id, '/import-export')}
                  tooltip="Import / Export"
                >
                  <Link to="/projects/$projectId/import-export" params={{ projectId: id }}>
                    <ArrowUpDown />
                    <span>Import / Export</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, id, '/activity')}
                  tooltip="Activity"
                >
                  <Link to="/projects/$projectId/activity" params={{ projectId: id }} search={{}}>
                    <Activity />
                    <span>Activity</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
