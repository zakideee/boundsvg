---
"@boundsvg/core": minor
---

Remove the shared default Engine and its 28 standalone initialization, rendering, compilation, inspection, and disposal exports. Retain the result of `createEngine` or `createEngineAsync` and call its methods instead. Replace `compileScene` with `engine.compile`, `hitTestOnIR` with `engine.hitTest`, and `isInitialized` with caller-owned readiness. Replace argument-free `initAsync()` with `createEngineAsync({})`. Reuse each instance and dispose it when its rendering context ends.

Output-affecting: the React terminal template displays the explicit Engine API, changing its rendered snippet text and tokens. Rendering the same scene with the same fonts and options is unchanged.
