# x-locale showcase

Screenshots for demos. Captured from local Docker (`http://localhost:5173`) against the seeded **Demo App**.

## Dashboard

| File | What it shows |
|------|----------------|
| [01-projects-dashboard.png](./01-projects-dashboard.png) | Project list |
| [13-login.png](./13-login.png) | Microsoft sign-in |
| [03-project-overview.png](./03-project-overview.png) | Overview, locales, recent activity |
| [02-strings-editor.png](./02-strings-editor.png) | String catalog (source `vi`, targets `en` / `ja`) |
| [10-strings-missing-en.png](./10-strings-missing-en.png) | Filter: missing English |
| [09-add-string.png](./09-add-string.png) | Add string dialog |
| [04-modules.png](./04-modules.png) | Modules (`auth`, `common`, `home`) |
| [11-tags.png](./11-tags.png) | Tags empty state |
| [19-new-tag.png](./19-new-tag.png) | New tag dialog |
| [05-import-export.png](./05-import-export.png) | Export JSON / Excel |
| [12-import.png](./12-import.png) | Import (dry run, JSON or Excel) |
| [06-activity.png](./06-activity.png) | Activity log, including a CLI push |
| [07-settings.png](./07-settings.png) | Languages, layout, API keys |

## CLI (terminal screenshots)

Real `locale` output, one image per command, plus a full session.

| File | Command |
|------|---------|
| [08-cli-workflow.png](./08-cli-workflow.png) | Full session: init → status → pull → push → status |
| [14-cli-init.png](./14-cli-init.png) | `locale init` |
| [15-cli-status.png](./15-cli-status.png) | `locale status` |
| [16-cli-pull.png](./16-cli-pull.png) | `locale pull` |
| [17-cli-push.png](./17-cli-push.png) | `locale push` (`common/search` updated) |
| [18-cli-status-synced.png](./18-cli-status-synced.png) | `locale status` after push |

Matching transcripts: `cli-01-init.txt` … `cli-05-status-after-push.txt`.

## Regenerate

Backend and frontend must already be up.

```bash
node docs/showcase/capture-screenshots.mjs
```

Uses system Chrome via Playwright (`e2e/node_modules`).
