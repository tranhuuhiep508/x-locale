import { getRouteApi, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlignLeft, Boxes, Tags, Clock } from 'lucide-react'
import { ActivityCard } from '@/features/activity/ActivityCard'
import { LocaleChip } from '@/components/brand/LocaleChip'
import {
  activityFeedQuery,
  languagesQuery,
  modulesQuery,
  projectQuery,
  tagsQuery,
} from '@/lib/queries'
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
      <Card className="h-full transition-shadow hover:shadow-sm">
        <CardContent className="flex items-start gap-4">
          <MarkWell>
            <Icon className="size-4" />
          </MarkWell>
          <div>
            <p className="font-heading text-2xl font-medium tracking-tight tabular-nums text-foreground">
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
  const { data: languages = [] } = useQuery(languagesQuery())
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
          <span className="flex flex-wrap items-center gap-2">
            <span className="capitalize">{project.layout} layout</span>
            <span aria-hidden>·</span>
            <LocaleChip code={project.base_language} languages={languages} variant="base" />
          </span>
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
            <CardTitle>Languages</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <LocaleChip code={project.base_language} languages={languages} variant="base" />
              <span className="font-mono text-muted-foreground">{project.string_count} strings</span>
            </div>
            {project.target_languages.map((locale) => (
              <div key={locale} className="flex items-center justify-between gap-3 text-sm">
                <LocaleChip code={locale} languages={languages} />
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
