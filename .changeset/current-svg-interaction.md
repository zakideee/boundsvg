---
"@boundsvg/core": minor
"@boundsvg/browser": minor
"@boundsvg/react": minor
---

Native paint retains browser hit behavior: WebKit can report zero-scale ink,
which can dispatch to an ancestor handler even when its semantic Frame is empty.

Use current native SVG paint and live semantic Frame poses for interactive hits,
including stationary hover during animation. Browser and React share one
attachment-owned controller for input, gestures and notifications.

After touch ends, compatibility mouse/click callbacks still dispatch, while
hover waits for a new eligible pointer lifecycle input. Fresh MouseEvent-only
input remains supported.

Use `hover` instead of `hoverSource`, and `point` instead of top-level `svgX`/`svgY`.
Narrow callback `cause`: scene notifications have `nativeEvent: null`.
Replace Path-specific hit helpers with `queryCurrentSvgHit`; snapshot inspection
continues through Core snapshot queries. Semantic Frames include rectangular
corners and support library-owned BoxClips with
finite affine poses. External clip/mask/visibility/pointer-event mutations are
not promised to match native paint for those Frames.
Canonical BoxClips and the IR viewport now use strict interiors. Frame rectangles
remain closed, but a Frame meeting a clip only at its outer boundary is excluded.
This changes `engine.hitTest`, `hitTest`, `buildHitTestIndex` and
`buildInspectHitTestIndex`, including snapshot paint selections on clip/viewport
boundaries. Native paint keeps browser behavior and may still reach ancestor
handlers. Native hits may still select Box paint touching only a clip boundary
and deliver its handler while a neighboring Box's color is visible. Frame gates do not
reapply Core clips to native paint, eliminate every visually hidden callback, or
fully restore earlier Browser hit behavior; SVG/PNG emission is unchanged.
An integer left/top boundary query at identity/DPR 1 may coincide with
the first painted pixel; fractional interior points remain eligible, so this is
not a one-pixel-wide exclusion band. Floating transforms are not snapped: tiny
computed overlaps can remain even at an authored ideal contact.
`isPointInViewport` is available from `@boundsvg/core/scene` for the same pure IR
viewport predicate; dimensions are checked and callers supply finite IR-root points.

The React `useInteractiveSvg` container must contain exactly one outer SVG
(`ownerSVGElement === null`). HTML wrappers around that SVG are supported;
nested SVG paint does not count as another outer root. No outer SVG or multiple
outer SVGs yield `hover: { status: "invalid", reason: "bindingMismatch" }` and no
input callback delivery from that binding until a matching single root is available.

`translateSvgCoords` now returns `SvgCoordinateResult` instead of `{x, y} | null`.
Check `result.status === "ready"` before reading `result.point.svgX` and
`result.point.svgY`; replace old `point.x`/`point.y` reads. The other states are
`invalid` (`nonFiniteClientPoint`) and `unavailable` (`detached` or
`coordinatesUnavailable`), rather than normal coordinate absence.

New exports from `@boundsvg/core/scene` include `HitPose`, `HitClip`,
`HitContainmentResult`, `queryFrameContainment` and `isSemanticFrame`. A `HitPose`
contains a main matrix and linear witnesses; a `HitClip` contains `parent`,
`pose` and canonical `geometry`. These interfaces were not previously public. The checked
`applyInverseAffineMatrixToPoint` projection and shared `SvgPoint` are also new
scene exports.
Snapshot consumers of the new query supply their IR matrix with explicit empty
`linearWitnesses`. Its point must be finite and in the same query coordinate
system as the poses: client CSS px for Browser queries, IR root px for snapshots.
The caller guarantees finiteness; the pure query does not recheck the point.
Use `isSemanticFrame` for canonical eligibility. Valid empty evidence takes
priority over unresolved calculations after all required inputs are validated.
External individual scale/rotate/translate and arbitrary 3D are outside the Frame
guarantee; even planar 3D syntax can become unavailable when native values are not
2D. Native paint remains delegated to the browser.

A positive bbox supplies a Frame only for a handler-bearing source with no
primary occurrence; ordinary empty Text can retain a content primary.
Automatic Text menus retain native Text through an ancestor Frame, while a
foreground Frame in another branch blocks them. Line-copy eligibility reads
IR-authored tracks; external CSS motion does not resample the TextMap or
guarantee current line selection.
