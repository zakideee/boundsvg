---
title: Canvas
---

# Canvas

Root element. Every render tree must start with a `<Canvas>`.

## Props

| Prop         | Type                     | Required | Description                                                              |
| ------------ | ------------------------ | -------- | ------------------------------------------------------------------------ |
| `width`      | `number`                 | Yes      | Canvas width in px                                                       |
| `height`     | `number`                 | Yes      | Canvas height in px                                                      |
| `background` | `string`                 |          | Background color                                                         |
| `language`   | `"ja" \| "en" \| "auto"` |          | Default language for text layout                                         |
| `meta`       | `Record<string, string>` |          | Metadata emitted as `data-boundsvg-meta-*` on the svg root (max 16 keys) |
| `debug`      | `boolean`                |          | Draw bounding boxes and guide lines                                      |
| `id`         | `string`                 |          | Stable NodeId for hit-testing                                            |
| `onClick`    | `string`                 |          | Click handler reference                                                  |

All 21 event handler props are supported. See [Event Handlers](/api/core#event-handlers) for the full list.

## Example

<!--@include: ../_generated/canvas-basic.md-->
