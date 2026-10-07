# Upstream baseline

Verified 2026-10-06. Fork: https://github.com/fabianxvogt/Supper-Board. GitHub API reports `fork: true`, parent `weezerhunter/Supper-Board`, default branch `main`. Development branch: `feat/nutrition-v1`.

- `origin`: https://github.com/fabianxvogt/Supper-Board.git
- `upstream`: https://github.com/weezerhunter/Supper-Board.git
- Cloned upstream HEAD: `0d31989d65933b6491bbfa5eb178e5a55c904f85` (2026-10-05T21:16:39-05:00).
- Exactly matches the roadmap's audited commit: no intervening upstream changes at clone time.
- Fork worktree was clean before implementation. The containing Development repository has unrelated changes; they are outside this project and must remain untouched.
- MIT license and original Copyright (c) 2026 Supper Board contributors retained without alteration.

## Observed implementation

`README.md`, `guides/data-model.md`, and `board/supper-board.html` confirm a Claude artifact database, free-text ingredients, one dinner per day, two-week planning, cook/leftovers/flex entries, thaw reminders, feedback, draft approval, qualitative staples/freezer and shopping additions. `pushBack` and swap write documents individually, so neither is atomic; undo has no expected-revision guard. `orderText` prefers previously generated text over current additions. Original screen/fullscreen/wake-lock controls are browser-dependent. Scheduled services are prompt templates, not standalone backend services.

The original board, automation, guides and GitHub Pages demo remain reference artifacts. The new Next/Supabase application will not use the demo shim as product persistence or inherit universal thawing/safety claims.

## Roadmap and runtime


Original demo smoke: served `docs/` on local port3181 and exercised real Chromium at390px. Push back one day displayed the new date; Undo restored the original date. Shopping rendered live extras, qualitative staple controls and freezer entries. The visible banner explicitly says sample data and browser-only saving. This confirms the reference UI behavior, not production persistence or atomicity.
The supplied specification is preserved verbatim in `IMPLEMENTATION_ROADMAP.md`. Implementation/code/docs use English; app UI follows its German default. Node 22.23.2, npm10.9.8, Docker28.0.4 are observed locally.

Owner requested parallel Luna6.0 workers. Model catalog confirms exact identity `openai-codex/gpt-6-luna`. Initial incorrect `gpt-6.0-luna` lookup failed and poisoned managed-launcher probe state; reported as a tooling issue. Four disjoint native workers launched with the exact catalog identity, with no model substitution.
