# AI Documentation Workflow

Use this workflow whenever code changes land.

## Purpose

Keep sprint tracking organized so these categories stay separate:

- Broadcast updates
- General edits and bug fixes
- Enhancements
- QA / risks

## Files To Maintain

- [CURRENT_SPRINT.md](c:/Documents/Cogito/saas/markdown/CURRENT_SPRINT.md)
- [RELEASE_NOTES.md](c:/Documents/Cogito/saas/markdown/RELEASE_NOTES.md)
- [README.md](c:/Documents/Cogito/saas/README.md)
- [TEMPLATE.md](c:/Documents/Cogito/saas/markdown/TEMPLATE.md)

## Rules

1. Never overwrite existing project docs wholesale if they already contain useful material.
2. Prefer editing and extending current files.
3. Put active work and internal notes in `CURRENT_SPRINT.md`.
4. Put short, user-facing shipped summaries in `RELEASE_NOTES.md`.
5. Update `README.md` whenever project usage guidance, supported workflows, or the main feature set changes.
6. Keep broadcast messaging separate from bugs and enhancements.

## Update Flow After A Change

1. Decide whether the change is a broadcast update, a general edit / bug fix, or an enhancement.
2. Add or update the item in `CURRENT_SPRINT.md`.
3. If the item is ready to announce to users, add a concise dated note to `RELEASE_NOTES.md`.
4. If the workflow itself changed, update `README.md` and/or this file.
5. Carry forward unfinished items instead of deleting them.

## Suggested Sprint Rhythm

1. Start sprint: duplicate the structure from [TEMPLATE.md](c:/Documents/Cogito/saas/markdown/TEMPLATE.md) into `CURRENT_SPRINT.md`.
2. During sprint: log changes as they happen.
3. End sprint: move shipped highlights into `RELEASE_NOTES.md`.
4. Start next sprint: refresh `CURRENT_SPRINT.md` with the new sprint header and carry over open items.
