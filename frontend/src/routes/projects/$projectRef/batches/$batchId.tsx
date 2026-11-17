import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/projects/$projectRef/batches/$batchId')({
  beforeLoad: ({ params: { projectRef, batchId } }) => {
    throw redirect({
      to: '/projects/$projectRef/strings',
      params: { projectRef },
      search: { batch_id: batchId, batch_kind: 'cli_push' },
      replace: true,
    })
  },
})
