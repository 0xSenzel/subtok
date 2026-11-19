# Subtok

## Project documentation

- `plans/media-playback.md` describes audio preloading, offline recovery, and video display checks.
- `plans/collection-link.md` describes playback from a public TikTok collection link.
- `plans/share-playlist.md` describes sharing collections and folders.
- `plans/onboarding-flow.md` describes the player entry and setup flow.
- `plans/mobile-fixes.md` records mobile layout and setup work.

Read the relevant plan before changing a documented area. In the same change, update the affected behavior, implementation, deployment, recovery, and verification details in place. Mark completed or invalidated plan items. Keep unrelated documentation intact and avoid duplicate plans or changelogs.

When a file in the offline player shell changes, increment the shell cache version in `web/sw.js`.
