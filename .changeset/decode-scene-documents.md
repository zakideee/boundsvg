---
"@boundsvg/core": minor
"@boundsvg/worker": minor
"@boundsvg/cli": minor
---

Add a recursive `decodeSceneDocument` boundary that returns a detached Scene
tree, make `fromSceneDocument` validate unknown input through that boundary,
and expose the five Scene decode resource limits. Invalid structure now uses
stable `SCENE_DECODE_*` fatal diagnostics.

Worker Scene requests now preserve those diagnostics across main-thread,
receive, pool, materialized-frame, and layout-transition paths while detaching
queued input and avoiding duplicate decodes within each trust boundary.

CLI Scene files now distinguish JSON syntax failures from structural Scene
failures and reuse the single decoded VNode for conversion and export.
