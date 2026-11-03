@AGENTS.md

## Claude Code

- Cloud environment setup: `.claude/setup.sh` (reuses the `.cursor/` scripts described in AGENTS.md; pass `--no-start` to skip launching services).
- Skills live in `.agents/skills/` and are exposed to Claude Code via the `.claude/skills` symlink.
