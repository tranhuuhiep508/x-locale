import { createFileRoute } from '@tanstack/react-router'
import { ImportExportPage } from '@/features/sync/ImportExportPage'

export const Route = createFileRoute('/projects/$projectId/import-export')({
  component: ImportExportPage,
})
