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
Frames meeting a clip only at a shared boundary still include that boundary and
participate in IR ranking, even when their paint was culled.

Frame poses now share current screen-prefix and native local linear evidence.
Core `queryFrameContainment` accepts `HitPose`, and `HitClip.matrix` is replaced
by `HitClip.pose`; snapshot callers pass explicit empty `linearWitnesses`.
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
