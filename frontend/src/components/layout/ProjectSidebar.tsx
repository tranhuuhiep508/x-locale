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
  SidebarGroupLabel,
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
      <SidebarHeader className="gap-4 px-3 py-4 group-data-[collapsible=icon]:px-2">
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
        <div className="rounded-xl border border-border/70 bg-card/80 p-3 shadow-2xs group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between mb-1">
            <span className="eyebrow text-[10px]">Project</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground uppercase font-medium">
              {project.layout}
            </span>
          </div>
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground" title={project.name}>
            {project.name}
          </h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {project.slug}
          </p>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-3 group-data-[collapsible=icon]:px-2">
          <SidebarGroupLabel>Catalog</SidebarGroupLabel>
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="px-3 group-data-[collapsible=icon]:px-2">
          <SidebarGroupLabel>Project</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
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
