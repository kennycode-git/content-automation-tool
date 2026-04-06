# Release Notes

## 2026-04-03

### Broadcast Updates

- Improved template routing so top presets now send users into the correct workflow more reliably.
- Added clearer tutorials for Images, Video Clips, and Layered so the main workflows are easier to learn.

### General Edits And Bug Fixes

- Fixed clip bundle titles not persisting as batch titles.
- Fixed clip preview generation using stale overlay text after edits.
- Fixed image templates applying in the wrong mode by switching them back into Images automatically.
- Capped clip-mode search terms to 3 per batch to reduce excessive clip searching.
- Fixed job cards and metadata controls so they are less crowded and easier to use on mobile.
- Fixed pricing/account navigation so signed-in users return to Account instead of being kicked back to Dashboard.

### Enhancements

- Added real overlay font loading in the frontend preview for better preview-to-render consistency.
- Improved mobile handling for clip preview cards and trim controls.
- Added paged clip browsing with a 60-second total selection cap in clip preview mode.
- Added stronger template feedback with auto-scroll, a loaded banner, and a highlight on the imported batch only.

## Notes

- Keep this file user-facing and concise.
- Put implementation detail, QA notes, and work-in-progress items in [CURRENT_SPRINT.md](c:/Documents/Cogito/saas/markdown/CURRENT_SPRINT.md) instead.
