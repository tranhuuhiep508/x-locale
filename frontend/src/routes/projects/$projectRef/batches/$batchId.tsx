import { createFileRoute } from '@tanstack/react-router'
import { BatchWorkspace } from '@/features/batches/BatchWorkspace'
import { batchWorkspaceSearchSchema } from '@/lib/schemas'

export const Route = createFileRoute('/projects/$projectRef/batches/$batchId')({
  validateSearch: (s: Record<string, unknown>) => batchWorkspaceSearchSchema.parse(s),
  component: BatchRoute,
})

function BatchRoute() {
  const { projectRef, batchId } = Route.useParams()
  const { from } = Route.useSearch()
  return (
    <BatchWorkspace
      key={`${projectRef}:${batchId}`}
      projectRef={projectRef}
      batchId={batchId}
      from={from}
    />
  )
}
