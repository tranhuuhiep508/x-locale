import { getRouteApi, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlignLeft, Boxes, Tags, Globe2, Clock } from 'lucide-react'
import {
  activitiesQuery,
  modulesQuery,
  projectQuery,
  tagsQuery,
} from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
const routeApi = getRouteApi('/projects/$projectId/')


function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ElementType
  label: string
  value: number | string
  href: string
}) {
  return (
    <Link to={href} className="group">
      <Card className="h-full transition-all hover:ring-primary/30 hover:shadow-sm">
        <CardContent className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function ProjectOverviewPage() {
  const { projectId } = routeApi.useParams()

  const { data: project } = useQuery(projectQuery(projectId))

  const { data: modules = [] } = useQuery(modulesQuery(projectId))

  const { data: tags = [] } = useQuery(tagsQuery(projectId))

  const { data: activityData } = useQuery(activitiesQuery(projectId, 1, 5))

  if (!project) return null

  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {project.layout} layout · base:{' '}
          <span className="font-mono font-medium">{project.base_language}</span>
        </p>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-8">
        <StatCard
          icon={AlignLeft}
          label="Strings"
          value={project.string_count}
          href={`/projects/${projectId}/strings`}
        />
        <StatCard
          icon={Boxes}
          label="Modules"
          value={modules.length}
          href={`/projects/${projectId}/modules`}
        />
        <StatCard
          icon={Tags}
          label="Tags"
          value={tags.length}
          href={`/projects/${projectId}/tags`}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-primary" />
              Languages
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge>base</Badge>
                <span className="font-mono">{project.base_language}</span>
              </div>
              <span className="text-muted-foreground">{project.string_count} strings</span>
            </div>
            {project.target_languages.map((locale) => (
              <div key={locale} className="flex items-center justify-between text-sm">
                <span className="font-mono text-foreground">{locale}</span>
                <Link
                  to="/projects/$projectId/strings"
                  params={{ projectId }}
                  search={{ missing_locale: locale }}
                  className="text-xs text-primary hover:underline"
                >
                  View missing
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {activityData?.items?.length ? (
              <div className="flex flex-col gap-2">
                {activityData.items.map((a) => (
                  <div key={a.id} className="text-sm">
                    <p className="text-foreground">{a.summary}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(a.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No activity yet</p>
            )}
            <Link
              to="/projects/$projectId/activity"
              params={{ projectId }}
              search={{}}
              className="text-xs text-primary hover:underline mt-1 inline-block"
            >
              View all activity →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
