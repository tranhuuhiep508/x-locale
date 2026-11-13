import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  AlignLeft,
  ArrowLeft,
  ArrowUpDown,
  Boxes,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  Settings,
  Tags,
} from 'lucide-react'
import type { Project, ProjectSummary } from '@/lib/api/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  projects?: ProjectSummary[]
  pendingCount?: number
}

export function ProjectSidebar({ project, projects, pendingCount = 0 }: ProjectSidebarProps) {
  const projectRef = project.slug
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const canSwitchProjects = (projects?.length ?? 0) > 1

  const passportContent = (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5 bg-border transition-colors duration-200 group-hover/passport:bg-primary"
      />
      <div className="pl-1.5">
        <div className="flex items-center justify-between gap-1.5">
          <h2
            className="truncate font-heading text-xs font-semibold tracking-tight text-foreground"
            title={project.name}
          >
            {project.name}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <span className="rounded border border-border/70 bg-muted/60 px-1 py-0.5 font-mono text-3xs font-medium uppercase text-muted-foreground">
              {project.layout}
            </span>
            {canSwitchProjects ? (
              <ChevronsUpDown className="size-3 text-muted-foreground transition-colors group-hover/passport:text-foreground" />
            ) : null}
          </div>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-3xs text-muted-foreground">
          <span className="truncate">{project.slug}</span>
          <span className="shrink-0">
            {project.base_language.toUpperCase()} → {project.target_languages.filter((l) => l !== project.base_language).length}
          </span>
        </div>
      </div>
    </>
  )

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
        {canSwitchProjects && projects ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Switch project"
                className="group/passport relative w-full overflow-hidden rounded-lg border border-border/80 bg-card px-2.5 py-2 text-left shadow-2xs transition-all duration-300 ease-drift hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:hidden"
              >
                {passportContent}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                Switch project
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {projects.map((item) => {
                const active = item.slug === project.slug || item.id === project.id
                return (
                  <DropdownMenuItem key={item.id} asChild>
                    <Link
                      to="/projects/$projectRef/strings"
                      params={{ projectRef: item.slug }}
                      search={{}}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{item.name}</p>
                        <p className="truncate font-mono text-3xs text-muted-foreground">
                          {item.slug}
                        </p>
                      </div>
                      {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="group/passport relative overflow-hidden rounded-lg border border-border/80 bg-card px-2.5 py-2 shadow-2xs transition-all duration-300 ease-drift hover:border-primary/40 hover:shadow-sm group-data-[collapsible=icon]:hidden">
            {passportContent}
          </div>
        )}
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
                {pendingCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-primary/15 px-1.5 py-0 font-mono text-3xs font-semibold tabular-nums text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {pendingCount}
                  </span>
                ) : null}
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
