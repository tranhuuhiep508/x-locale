import { createFileRoute } from '@tanstack/react-router'
import { BatchWorkspace } from '@/features/batches/BatchWorkspace'

export const Route = createFileRoute('/projects/$projectRef/batches/$batchId')({
  component: BatchRoute,
})

function BatchRoute() {
  const { projectRef, batchId } = Route.useParams()
  return (
    <BatchWorkspace key={`${projectRef}:${batchId}`} projectRef={projectRef} batchId={batchId} />
  )
}
