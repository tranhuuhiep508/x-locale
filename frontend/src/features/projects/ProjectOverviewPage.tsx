import { getRouteApi, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlignLeft, Boxes, Tags, Globe2, Clock } from 'lucide-react'
import { ActivityCard } from '@/features/activity/ActivityCard'
import {
  activityFeedQuery,
  modulesQuery,
  projectQuery,
  tagsQuery,
} from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MarkWell, PageBody, PageHeader } from '@/components/layout/PageHeader'

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
      <Card className="sky-panel h-full transition-shadow hover:shadow-sm hover:ring-primary/25">
        <CardContent className="flex items-start gap-4">
          <MarkWell className="group-hover:bg-primary/15">
            <Icon className="size-4" />
          </MarkWell>
          <div>
            <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
              {value}
            </p>
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

  const { data: activityData } = useQuery(activityFeedQuery(projectId, { page: 1, page_size: 5 }))

  if (!project) return null

  return (
    <PageBody>
      <PageHeader
        eyebrow="Catalog"
        title="Overview"
        description={
          <>
            {project.layout} layout · base{' '}
            <span className="font-mono font-medium text-foreground">{project.base_language}</span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <p className="eyebrow">Locales</p>
            <CardTitle className="flex items-center gap-2">
              <Globe2 className="size-4 text-primary" />
              Languages
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge>base</Badge>
                <span className="font-mono">{project.base_language}</span>
              </div>
              <span className="font-mono text-muted-foreground">{project.string_count} strings</span>
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
            <p className="eyebrow">Log</p>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {activityData?.items?.length ? (
              <div className="flex flex-col gap-1">
                {activityData.items.map((card) => (
                  <ActivityCard
                    key={card.id}
                    card={card}
                    projectId={projectId}
                    compact
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No activity yet</p>
            )}
            <Link
              to="/projects/$projectId/activity"
              params={{ projectId }}
              search={{}}
              className="mt-1 inline-block text-xs text-primary hover:underline"
            >
              View all activity →
            </Link>
          </CardContent>
        </Card>
      </div>
    </PageBody>
  )
}
