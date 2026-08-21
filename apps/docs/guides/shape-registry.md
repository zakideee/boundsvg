---
title: Shape Registry
---

# Shape Registry

Use the engine registry when the same geometry or symbol appears repeatedly across scenes.

## Geometry Registration

```ts
const engine = await createEngineAsync({ fonts });

engine.registerGeometry("pill", {
  viewBox: { width: 140, height: 64 },
  root: {
    kind: "path",
    d: "M12 0H128C134.627 0 140 5.373 140 12V52C140 58.627 134.627 64 128 64H12C5.373 64 0 58.627 0 52V12C0 5.373 5.373 0 12 0Z",
  },
});
```

Then reference it from a scene:

```tsx
<Shape geometryId="pill" width={180} height={82} fill="#38bdf8" />
```

## Symbol Registration

Symbols wrap a geometry document plus metadata such as anchors and elastic segments:

```ts
engine.registerSymbol("arrow", arrowSymbol);
```

```tsx
<Symbol symbolId="arrow" width={220} height={24} fill="#f8fafc" />
```

## Design Notes

- Registration happens before layout. `Shape` and `Symbol` are expanded into ordinary boundsvg nodes during compile.
- The registry is local to an `Engine` instance.
- `geometry` / `symbol` inline props still work when you do not need reuse.
- Keep chart semantics outside of the registry. The registry stores reusable low-level drawing assets, not scales or series logic.
