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
} from '@/components/ui/sidebar'

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
  const projectRef = project.slug
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <Sidebar collapsible="icon">
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
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Project
          </p>
          <h2 className="mt-0.5 truncate text-sm font-semibold" title={project.name}>
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
                  isActive={isProjectPath(pathname, projectRef, '', true)}
                  tooltip="Overview"
                >
                  <Link to="/projects/$projectRef" params={{ projectRef }}>
                    <LayoutDashboard />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, projectRef, '/strings')}
                  tooltip="Strings"
                >
                  <Link to="/projects/$projectRef/strings" params={{ projectRef }} search={{}}>
                    <AlignLeft />
                    <span>Strings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, projectRef, '/modules')}
                  tooltip="Modules"
                >
                  <Link to="/projects/$projectRef/modules" params={{ projectRef }}>
                    <Boxes />
                    <span>Modules</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, projectRef, '/tags')}
                  tooltip="Tags"
                >
                  <Link to="/projects/$projectRef/tags" params={{ projectRef }}>
                    <Tags />
                    <span>Tags</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, projectRef, '/settings')}
                  tooltip="Settings"
                >
                  <Link to="/projects/$projectRef/settings" params={{ projectRef }}>
                    <Settings />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, projectRef, '/import-export')}
                  tooltip="Import / Export"
                >
                  <Link to="/projects/$projectRef/import-export" params={{ projectRef }}>
                    <ArrowUpDown />
                    <span>Import / Export</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isProjectPath(pathname, projectRef, '/activity')}
                  tooltip="Activity"
                >
                  <Link to="/projects/$projectRef/activity" params={{ projectRef }} search={{}}>
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
