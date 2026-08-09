import { Link, useRouterState } from '@tanstack/react-router'
import {
  LayoutDashboard,
  AlignLeft,
  Boxes,
  Tags,
  Settings,
  ArrowUpDown,
  Activity,
  Camera,
  ArrowLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project } from '@/lib/api/types'
import { Separator } from '@/components/ui'

function useSideLink(suffix: string, projectId: string, exact = false) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const href = `/projects/${projectId}${suffix}`
  const isActive = exact
    ? pathname === href || pathname === `${href}/`
    : pathname === href || pathname.startsWith(`${href}/`)
  return { isActive, href }
}

const linkCls = (isActive: boolean) =>
  cn(
    'flex items-center gap-2.5 px-4 py-2 text-sm transition-colors',
    isActive
      ? 'text-primary bg-primary/10 border-r-2 border-primary font-medium'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
  )

interface ProjectSidebarProps {
  project: Project
}

export function ProjectSidebar({ project }: ProjectSidebarProps) {
  const id = project.id
  const overviewLink = useSideLink('', id, true)
  const stringsLink = useSideLink('/strings', id)
  const modulesLink = useSideLink('/modules', id)
  const tagsLink = useSideLink('/tags', id)
  const settingsLink = useSideLink('/settings', id)
  const ieLink = useSideLink('/import-export', id)
  const activityLink = useSideLink('/activity', id)
  const versionsLink = useSideLink('/versions', id)

  return (
    <aside className="w-56 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="px-4 py-4">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </Link>
        <div>
          <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Project</p>
          <h2 className="text-sm font-semibold text-foreground mt-0.5 truncate" title={project.name}>
            {project.name}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{project.slug}</p>
        </div>
      </div>
      <Separator />
      <nav className="flex-1 py-2">
        <Link
          to="/projects/$projectId"
          params={{ projectId: id }}
          className={linkCls(overviewLink.isActive)}
        >
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          Overview
        </Link>
        <Link
          to="/projects/$projectId/strings"
          params={{ projectId: id }}
          search={{}}
          className={linkCls(stringsLink.isActive)}
        >
          <AlignLeft className="h-4 w-4 shrink-0" />
          Strings
        </Link>
        <Link
          to="/projects/$projectId/modules"
          params={{ projectId: id }}
          className={linkCls(modulesLink.isActive)}
        >
          <Boxes className="h-4 w-4 shrink-0" />
          Modules
        </Link>
        <Link
          to="/projects/$projectId/tags"
          params={{ projectId: id }}
          className={linkCls(tagsLink.isActive)}
        >
          <Tags className="h-4 w-4 shrink-0" />
          Tags
        </Link>
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId: id }}
          className={linkCls(settingsLink.isActive)}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </Link>
        <Link
          to="/projects/$projectId/import-export"
          params={{ projectId: id }}
          className={linkCls(ieLink.isActive)}
        >
          <ArrowUpDown className="h-4 w-4 shrink-0" />
          Import / Export
        </Link>
        <Link
          to="/projects/$projectId/activity"
          params={{ projectId: id }}
          search={{}}
          className={linkCls(activityLink.isActive)}
        >
          <Activity className="h-4 w-4 shrink-0" />
          Activity
        </Link>
        <Link
          to="/projects/$projectId/versions"
          params={{ projectId: id }}
          className={linkCls(versionsLink.isActive)}
        >
          <Camera className="h-4 w-4 shrink-0" />
          Versions
        </Link>
      </nav>
    </aside>
  )
}
