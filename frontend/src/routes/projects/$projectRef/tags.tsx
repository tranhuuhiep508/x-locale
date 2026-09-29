import { createFileRoute } from '@tanstack/react-router'
import { TagsPage } from '@/features/tags/TagsPage'

export const Route = createFileRoute('/projects/$projectRef/tags')({
  component: TagsPage,
})
