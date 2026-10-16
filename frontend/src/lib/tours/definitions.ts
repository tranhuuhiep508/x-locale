import type { TourStep } from '@/lib/tours/steps'

const importRoles = ['admin', 'editor'] as const

/**
 * Designer's final copy. Each step stays on the screen that owns its target.
 * The create-project steps are `project-new` so finishing the list does not hide them.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    tourId: 'projects',
    target: 'project-list',
    title: 'Projects',
    body: 'Every project you belong to is listed here.',
  },
  {
    tourId: 'projects',
    target: 'cli-sync-hint',
    title: 'CLI sync',
    body: 'Sync strings from your code with the CLI. Set it up in Settings → API keys.',
  },
  {
    tourId: 'projects',
    target: 'new-project',
    title: 'New project',
    body: "Anyone can create a project. You become its Admin. The next two steps are on the /projects/new page, which is a full page, not a dialog.",
  },
  {
    tourId: 'project-new',
    target: 'project-locales',
    title: 'Languages',
    body: 'Choose your source language and target languages. Admins can change them later in Settings.',
  },
  {
    tourId: 'project-new',
    target: 'project-context',
    title: 'Translation context',
    body: "Translation context (up to 500 characters) is added to the AI translation prompt, along with module context and each string's description.",
  },
  {
    tourId: 'strings',
    target: 'grid',
    title: 'String keys',
    body: 'Each row is a string key.',
  },
  {
    tourId: 'strings',
    target: 'string-open',
    title: 'Edit a string',
    body: "Open a string to edit it. 'Save changes' saves a draft. It isn't live until you turn on Published.",
  },
  {
    tourId: 'strings',
    target: 'publish-toggle',
    title: 'Published',
    body: 'The Published switch makes your changes live.',
  },
  {
    tourId: 'strings',
    target: 'modules',
    title: 'Modules',
    body: 'Modules group related keys and can each have their own context.',
  },
  {
    tourId: 'strings',
    target: 'search',
    title: 'Search',
    body: 'Search matches keys, source text, and descriptions, but not translations.',
  },
  {
    tourId: 'strings',
    target: 'sort',
    title: 'Sort',
    body: 'Sort by key, source text, status, or when and by whom a string was updated or created.',
  },
  {
    tourId: 'strings',
    target: 'time-filter',
    title: 'Time range',
    body: 'Filter by the last hour, 24 hours, or 7 to 90 days, or choose a custom range.',
  },
  {
    tourId: 'import',
    target: 'import-file',
    title: 'Import a file',
    body: 'Import a JSON or Excel file into a module.',
    roles: importRoles,
  },
  {
    tourId: 'import',
    target: 'import-format',
    title: 'JSON format',
    body: 'JSON must use flat keys, for example "home.title": "Hello".',
    roles: importRoles,
  },
  {
    tourId: 'import',
    target: 'import-conflicts',
    title: 'Conflicts',
    body: 'Any conflict rejects the whole file. Nothing is written until every check passes.',
    roles: importRoles,
  },
  {
    tourId: 'import',
    target: 'import-lock',
    title: 'One at a time',
    body: "Only one import or CLI push can run per project at a time. If another is running, you'll see 'busy'. Try again shortly.",
    roles: importRoles,
  },
  {
    tourId: 'import',
    target: 'import-submit',
    title: 'Undo a batch',
    body: 'Each import appears in Activity as one batch you can undo.',
    roles: importRoles,
  },
]
