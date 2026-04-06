# Current Sprint

## Sprint

- Name: Sprint 2
- Status: In progress
- Goal: Fix preview-to-render parity issues, tighten mobile interactions, and polish tutorial onboarding surfaces.
- Owner: Codex + project owner
- Last updated: 2026-04-05

## Broadcast Updates

- No user broadcast drafted yet.
- Use this section for product/update messages that should be communicated externally or to customers.

## General Edits And Bug Fixes

- Done: Overlay text preview now uses shared line-breaking/layout logic so words no longer spill off-screen and the small + expanded previews match each other much more closely.
- Done: Batch-level and panel-level overlay previews now follow the same wrapping and positioning rules as the final render logic, including long-word breaking near tight margins.
- Done: Tutorial start cards now show the PassiveClip logo with the PassiveClip name at the top.
- Done: On mobile, the top template carousel arrows now disable at the ends so repeated taps cannot trigger the end-of-list glitch.

- Done: Clip bundle titles now persist as batch titles in video clips mode.
- Done: Template routing is mode-aware and resets stale preview state when switching flows.
- Done: Top templates now switch into the correct workflow, so current image templates always return to Images instead of applying inside Layered or Clips.
- Done: Clip preview cards now loop the trimmed section so preview better matches the final render.
- Done: Clip preview generation now uses the live batch state, so overlay text changes are respected when clicking `Generate with N clip(s)`.
- Done: Clip-mode batch terms are capped at 3 search terms per batch.
- Done: Frontend overlay preview now loads the real overlay font files instead of generic browser fallbacks.
- Done: Added a `Dismiss all` control for Current jobs so completed items can be cleared into Recent jobs in one click.
- Done: Added a `Delete visible` control for Recent jobs so multiple recent jobs can be removed in one action.
- Verified: Completed current jobs already auto-dismiss into Recent jobs after 2 hours via the existing completion timer.
- Done: Recent jobs bulk clear now permanently removes the job rows and their files instead of leaving deleted entries behind.
- Done: Removed the layered Step 2 helper line about background videos being selected in Step 1.
- Done: Current jobs that land in a `Deleted` state now show a terminal card with a re-run action instead of looking like an in-progress render.
- Done: Re-edit video now uses a colour-theme dropdown in both Current jobs and Recent jobs instead of the old pill selector.
- Done: Main dashboard layered generation now forwards philosopher settings again, so philosopher images appear in both the final render and job metadata.
- Done: Re-edit video now supports reusing saved custom colour themes, preserves accent/philosopher metadata more reliably, and reapplies accent/philosopher assets during rerender.
- Done: Completed and recent job metadata is now tucked behind an info icon so cards feel less crowded.
- Done: Completed-job headers now have a clearer mobile-friendly collapse target and larger dismiss target.
- Done: Mobile navbar now hides the Schedule tab and uses the proper combined PassiveClip logo size instead of a squashed mark.
- Done: Pricing/account outside-click flow now returns to Account instead of forcing users back to Dashboard.

## Enhancements

- Done: Added real frontend overlay font loading for closer preview-to-render parity.
- Done: Improved mobile clip preview layout so trim sliders no longer push out as aggressively on small screens.
- Done: Added bulk cleanup controls for Current jobs and Recent jobs.
- Done: Added layered background video opacity control without requiring schema changes outside the existing JSON config.
- Done: Added clear/collapse controls and tighter mobile layout for the per-batch background video picker.
- Done: Layered re-edit now exposes foreground opacity, background opacity, and colour-grade targeting for foreground, background, or both, and passes those settings through the rerender pipeline.
- Done: Layered preset saves now include foreground opacity, background opacity, and grade-target settings.
- Done: Background video search now supports local favorites for quick reuse from a starred list.
- Done: Added a tutorial hub with separate tours for Images, Video Clips, and Layered, plus stronger page intros and fuller layered coverage.
- Done: Top templates now auto-scroll into the editor, show a temporary loaded banner, and pulse only the imported batch card.
- Done: Video Clips now defaults to `Night Sky`, uses 1 clip per search by default, supports paged preview browsing, and enforces a persistent 60-second selection cap.
- Done: Overlay font size controls now use a 0.5 to 5 range with a 1.5 default, and preview parity between small and expanded views is tighter.
- Next: Add dedicated top templates for clips mode.
- Next: Add dedicated top templates for layered mode.
- Next: Add an explicit "source template mode" label on template cards if mixed-mode presets become common.

## QA / Risks

- Verified: `npm run build` in `frontend`
- Verified: backend read-only syntax parse passed for `schemas.py`, `jobs.py`, `preview.py`, `job_manager.py`, and `layered_builder.py`
- Risk: Existing preview layout should be manually checked on an actual mobile viewport after the latest trim UI changes.
- Risk: Font parity should be spot-checked across Garamond, Cinzel, Uncial, and JetBrains Mono.
- Risk: Tutorial auto-scroll behaviour should still be verified in the live dev environment because it has behaved differently locally versus dev before.
- Risk: Overlay preview should still be spot-checked in dev against a few real rendered videos for fonts with unusual widths.
- Risk: Template carousel end-stop should still be checked on a physical mobile device for smooth-scroll timing differences.

## Next Up

- Spot-check overlay parity in dev using a few long quotes and different margin settings.
- Move completed user-facing items into [RELEASE_NOTES.md](c:/Documents/Cogito/saas/markdown/RELEASE_NOTES.md) when they are ready to announce.
