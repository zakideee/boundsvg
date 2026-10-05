---
"@boundsvg/core": minor
"@boundsvg/browser": minor
"@boundsvg/worker": minor
"@boundsvg/cli": minor
---

Replace animated WebP/GIF byte-returning APIs with required sink writes returning `Promise<AnimatedRasterWriteResult>`. The existing Core normal/compiled and Worker normal/layout-transition method names now require a destination; old two-argument calls, overloads, bulk animation transport, and `ToSink` aliases are removed. WASM bridge schema advances from 32 to 33.

Sample and encode each frame inside WASM without transporting frame SVGs through JS. Encode sequentially with lazy sampled schedules, bounded chunks, WebP length patching, and file or external spool destinations. Remove the fixed total-frame and aggregate-SVG limits. Existing raster, per-frame timing, iterations, and container representation limits remain. `createAnimatedRasterCollector()` explicitly retains O(output) memory and a 256 MiB limit.

Authenticate optional inputs: only missing/undefined means absence. Null, wrong types, typed arrays, and custom iterables now reject with structured diagnostics rather than old runtime falsy acceptance or raw TypeErrors. Fractional FPS, positive subnormal sampled durations, and duplicate/non-monotonic explicit times remain accepted within the documented domains.

Add browser file-handle/OPFS-compatible storage and a Node `@boundsvg/cli/animation` adapter. Animated CLI files use temp plus atomic pathname replacement, preserve captured regular-file permission bits, replace a final symlink itself, and leave other hardlinks on the old inode. Parent directory rename permissions are required; inode/owner/ACL/xattr and competing update exclusion are not guaranteed. Static output IO is unchanged.

Keep Core cancellation cooperative through pending callbacks. Worker absolute deadlines include pending finish; an early rejection can leave commitment uncertain and retains ownership until cleanup. Successful output is preserved after late finish or close acknowledgement failure. Watch exports serialize per Engine and coalesce changes per path.

Animation backend hooks receive required fixed `renderOptions` at session open. Managed pushes take `push(scene, timeMs, durationMs)` with primitive finite nonnegative times and integer durations; the generated native method takes scene/session capabilities plus these separate numbers. Fixed-setting errors are reported at open, and duplicate native open keys reject. Regenerate node and web WASM artifacts together with bridge types.

Expose `decodeAnimatedRasterFatal(value: unknown): FatalError | undefined` from `@boundsvg/core/wasm` for transport adapters. Animated raster options reject `timeMs`, which is outside their public option types. Invalid WebP sequential spool destinations now retain the WebP diagnostic format without requiring patch support.
