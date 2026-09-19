---
"@boundsvg/core": minor
"@boundsvg/react": minor
"@boundsvg/worker": minor
---

Unify React async rendering across main and Worker execution. Import the seven existing async hooks from `@boundsvg/react/async`; the former `/worker` entry and `UseWorkerRenderResult` type are removed. Results expose status, execution, and staleness, retain the same owner's previous success by default, and accept explicit revision, retention, and error-notification controls. `BoundSvg` and `AnimatedBoundSvg` now use this async path on main as well. Synchronous hooks keep their responsibilities and gain revision and Engine resource invalidation. PNG buffers are isolated per consumer.

Add Core resource version observation and Provider resource revisions. Worker preference falls back only during initialization; runtime failures remain errors. Main and Worker execution admit one job plus 32 queued requests. Worker render and measurement calls accept an AbortSignal, and terminal drain waits for physical completion. Timeout values must be integers from 1 through 2,147,483,647ms, including queue wait. A raw Worker cannot be attached again after its first Engine lifetime. Pools retain default concurrency two and maximum eight, allow only one active operation, and wait for stream cleanup before reuse.

Async inputs now follow immutable VNode identity, shallow non-callback option values and nested identities. Stabilize VNodes and nested options with state or `useMemo`; creating them inline on every hook render can repeatedly schedule work. Changes in place require a new `revision`. Callback-only changes do not schedule rendering. Synchronous render and derived hooks accept `RenderInputOptions` (`revision`) in their third argument; `usePngObjectUrl` accepts it in the second argument, and `useInteractiveSvg` includes it in its existing third options argument.
