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
      <SidebarHeader className="gap-2 px-2.5 py-2.5 group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="All projects" size="sm">
              <Link to="/" className="group/back">
                <ArrowLeft className="transition-transform duration-200 ease-drift group-hover/back:-translate-x-0.5" />
                <span>All projects</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="group/passport relative overflow-hidden rounded-lg border border-border/80 bg-card px-2.5 py-2 shadow-2xs transition-all duration-300 ease-drift hover:border-primary/40 hover:shadow-sm group-data-[collapsible=icon]:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-primary/85 transition-all duration-300 group-hover/passport:w-1.5"
          />
          <div className="pl-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <h2
                className="truncate font-heading text-xs font-semibold tracking-tight text-foreground"
                title={project.name}
              >
                {project.name}
              </h2>
              <span className="shrink-0 rounded border border-border/70 bg-muted/60 px-1 py-0.2 font-mono text-[9px] font-medium uppercase text-muted-foreground">
                {project.layout}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
              <span className="truncate">{project.slug}</span>
              <span className="shrink-0 text-primary">
                {project.base_language.toUpperCase()} → {project.target_languages.filter((l) => l !== project.base_language).length}
              </span>
            </div>
          </div>
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
                  isActive={isProjectPath(pathname, projectRef, '/activity') || isProjectPath(pathname, projectRef, '/batches')}
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
