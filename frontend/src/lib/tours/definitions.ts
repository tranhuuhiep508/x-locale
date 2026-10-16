import type { TourStep } from '@/lib/tours/steps'

const importRoles = ['admin', 'editor'] as const
const adminOnly = ['admin'] as const

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
  {
    tourId: 'settings',
    target: 'settings-general',
    title: 'Project settings',
    body: 'Name, base language, layout, and target languages.',
  },
  {
    tourId: 'settings',
    target: 'dup-keys',
    title: 'Duplicate keys',
    body: "Allow duplicate keys across modules. You can't turn this off while duplicates exist.",
  },
  {
    tourId: 'settings',
    target: 'settings-context',
    title: 'Translation context',
    body: 'Translation context for AI translation.',
  },
  {
    tourId: 'settings',
    target: 'members',
    title: 'Members',
    body: 'Add or remove members and change roles. Admins manage members and settings. Editors do all string work.',
    roles: adminOnly,
  },
  {
    tourId: 'settings',
    target: 'member-remove',
    title: 'Remove a member',
    body: "Removing a member isn't logged and can't be undone. A project always needs at least one Admin.",
    roles: adminOnly,
  },
  {
    tourId: 'settings',
    target: 'api-keys',
    title: 'API keys',
    body: 'Generate a personal API key here. Generating a new one revokes your old key.',
  },
  {
    tourId: 'settings',
    target: 'loc-init',
    title: 'loc init',
    body: 'Run <code>loc init -k &lt;your key&gt;</code> in your repo.',
  },
  {
    tourId: 'settings',
    target: 'loc-push',
    title: 'loc push',
    body: '<code>loc push</code> sends base-language strings that changed since your last push (<code>--full</code> sends all of them). It creates and updates keys but never deletes them.',
  },
  {
    tourId: 'settings',
    target: 'push-limits',
    title: 'Push limits',
    body: "A push is rejected if a key is queued for deletion or already deleted, or if the base language doesn't match. Pushes of more than 5,000 keys run in the background.",
  },
  {
    tourId: 'activity',
    target: 'activity-list',
    title: 'Activity',
    body: 'Every string and translation change is listed here.',
  },
  {
    tourId: 'activity',
    target: 'batch-undo',
    title: 'Undo a batch',
    body: "Imports, AI translations, and batch actions can each be undone as a whole batch. An undo can't itself be undone.",
    roles: importRoles,
  },
  {
    tourId: 'activity',
    target: 'string-history',
    title: 'String history',
    body: 'To revert a single string, open its History and restore an earlier version.',
  },
  {
    tourId: 'activity',
    target: 'restore-limits',
    title: 'Restore limits',
    body: "History can't restore publish or unpublish actions or deletes. To bring back a deleted string, use the Deleted filter and choose Restore.",
  },
]
