import { createElement, type VNode } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-live-interaction-harness.js";

/** A valid one-pixel image already used by the Engine animation regression suite. */
const IMAGE_SOURCE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Public producer input; points and translation are independent of native query results. */
function scene(
  kind: "path" | "rect" | "image" | "frame",
  animated: boolean,
  clipped = false,
): VNode {
  const references = {
    onClick: "select",
    onPointerEnter: "enter",
    onPointerLeave: "leave",
    onPointerMove: "move",
    onPointerDown: "down",
    onPointerUp: "up",
    onPointerCancel: "cancel",
  };
  const content =
    kind === "path"
      ? createElement("Path", {
          id: "subject",
          width: 100,
          height: 60,
          d: "M0 0H100V60H0Z",
          fill: "red",
          ...references,
        })
      : kind === "image"
        ? createElement("Image", {
            id: "subject",
            width: 100,
            height: 60,
            src: IMAGE_SOURCE,
            ...references,
          })
        : createElement("Box", {
            id: "subject",
            width: 100,
            height: 60,
            ...(kind === "rect" ? { background: "red" } : {}),
            ...references,
          });
  const moving = createElement(
    "Box",
    {
      position: "absolute",
      left: 40,
      top: 20,
      width: 100,
      height: 60,
      ...(animated
        ? {
            animate: {
              keyframes: [
                { at: 0, transform: { translateX: 0 } },
                { at: 1, transform: { translateX: 120 } },
              ],
              durationMs: 1200,
              easing: "linear",
              fill: "both",
            },
          }
        : {}),
    },
    content,
  );
  return createElement(
    "Canvas",
    { width: 320, height: 120 },
    clipped
      ? createElement(
          "Box",
          { position: "absolute", width: 120, height: 100, overflow: "clip", borderRadius: 20 },
          moving,
        )
      : moving,
  );
}

/** Two frames separate native seek/style updates from the next observation. */
async function flush(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Each case loads a clean test page and mounts the actual Engine/React adapter. */
async function mount(
  page: Page,
  vnode: VNode,
  options: Parameters<Window["boundsvgLive"]["mount"]>[1],
): Promise<void> {
  await page.goto("/e2e-live-interaction.html");
  await page.waitForFunction(() => !!window.boundsvgLive);
  await page.evaluate(({ input, options }) => window.boundsvgLive.mount(input, options), {
    input: vnode,
    options,
  });
  await page.waitForFunction(
    () => window.boundsvgLive.read().ready || window.boundsvgLive.read().error !== null,
  );
  expect(await page.evaluate(() => window.boundsvgLive.read().error)).toBeNull();
  await flush(page);
}

for (const adapter of ["react", "vanilla"] as const) {
  for (const kind of ["path", "rect", "image", "frame"] as const) {
    test(`${adapter} ${kind}: current seek and stationary enter/leave follow endpoint pose`, async ({
      page,
    }, testInfo) => {
      await mount(page, scene(kind, true), { adapter, animated: true, scope: "document" });
      expect(await page.evaluate(() => window.boundsvgLive.seek(0))).toBeGreaterThan(0);
      await flush(page);
      await page.mouse.move(100, 50);
      await flush(page);
      expect(await page.evaluate(() => window.boundsvgLive.read().hover)).toBe("subject");
      await page.evaluate(() => {
        window.boundsvgLive.clear();
        window.boundsvgLive.seek(800);
      });
      await flush(page);
      const outside = await page.evaluate(() => window.boundsvgLive.read(100, 50));
      expect(outside.hover).toBeNull();
      expect(outside.query).toMatchObject({ status: "ready", hit: null });
      expect(outside.deliveries).toEqual([
        expect.objectContaining({ handlerName: "leave", cause: "scene", nativeType: null }),
      ]);
      await page.evaluate(() => {
        window.boundsvgLive.clear();
        window.boundsvgLive.seek(400);
      });
      await flush(page);
      const inside = await page.evaluate(() => window.boundsvgLive.read(100, 50));
      expect(inside.hover).toBe("subject");
      expect(inside.deliveries).toEqual([
        expect.objectContaining({ handlerName: "enter", cause: "scene", nativeType: null }),
      ]);
      await page.mouse.click(100, 50);
      const clicked = await page.evaluate(() => window.boundsvgLive.read(100, 50));
      expect(clicked.deliveries.filter((event) => event.handlerName === "select")).toHaveLength(1);
      await page.evaluate(() => {
        window.boundsvgLive.clear();
        window.boundsvgLive.seek(0);
        window.boundsvgLive.seek(null);
      });
      await expect.poll(() => page.evaluate(() => window.boundsvgLive.read().hover)).toBeNull();
      const freeRun = await page.evaluate(() => window.boundsvgLive.read(100, 50));
      expect(freeRun.deliveries.every((event) => event.handlerName !== "move")).toBe(true);
      await testInfo.attach("current-scene-trace", {
        body: JSON.stringify({ outside, inside, clicked, freeRun }),
        contentType: "application/json",
      });
    });
  }

  for (const scope of ["document", "open", "closed", "slot"] as const) {
    test(`${adapter} empty Frame and outer HTML遮蔽 in ${scope}`, async ({ page }, testInfo) => {
      await mount(page, scene("frame", false), { adapter, animated: false, scope });
      await page.mouse.move(100, 50);
      await flush(page);
      const empty = await page.evaluate(() => window.boundsvgLive.read(100, 50));
      expect(empty.query).toMatchObject({ status: "ready", hit: { nodeId: "subject" } });
      expect(empty.hover).toBe("subject");
      await page.evaluate(() => {
        const overlay = document.createElement("div");
        overlay.style.cssText =
          "position:fixed;left:40px;top:20px;width:100px;height:60px;background:black;z-index:10";
        document.body.append(overlay);
      });
      const blocked = await page.evaluate(() => window.boundsvgLive.read(100, 50));
      expect(blocked.query).toMatchObject({ status: "ready", hit: null });
      await testInfo.attach("scope-gate", {
        body: JSON.stringify({ empty, blocked }),
        contentType: "application/json",
      });
    });
  }

  test(`${adapter} current ancestor clip excludes the moved Frame`, async ({ page }) => {
    await mount(page, scene("frame", true, true), { adapter, animated: true, scope: "document" });
    await page.evaluate(() => window.boundsvgLive.seek(800));
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read(160, 50).query)).toMatchObject({
      status: "ready",
      hit: null,
    });
    await page.evaluate(() => window.boundsvgLive.seek(0));
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read(100, 50).query)).toMatchObject({
      status: "ready",
      hit: { nodeId: "subject" },
    });
  });

  test(`${adapter} external release closes the down owner once`, async ({ page }) => {
    await mount(page, scene("frame", false), { adapter, animated: false, scope: "document" });
    await page.mouse.move(100, 50);
    await page.mouse.down();
    await page.mouse.move(360, 160);
    await page.mouse.up();
    const result = await page.evaluate(() => window.boundsvgLive.read());
    expect(result.deliveries.filter((event) => event.handlerName === "cancel")).toHaveLength(1);
    expect(result.deliveries.filter((event) => event.handlerName === "up")).toHaveLength(0);
  });
}
