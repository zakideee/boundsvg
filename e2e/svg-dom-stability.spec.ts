import { createElement, type VNode } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-svg-dom-stability-harness.js";

/** A real animated red circle with an interactive sibling behind it. */
function movingScene(nodeId = "path", isAnimated = true): VNode {
  return createElement(
    "Canvas",
    { width: 300, height: 100, background: "white" },
    createElement("Box", {
      id: "underlay",
      position: "absolute",
      width: 300,
      height: 100,
      background: "blue",
      onClick: "underlay-click",
    }),
    createElement(
      "Box",
      {
        position: "absolute",
        left: nodeId === "changed" ? 180 : 100,
        top: 20,
        width: 40,
        height: 40,
        ...(isAnimated
          ? {
              animate: {
                keyframes: [
                  { at: 0, transform: { translateX: 0 } },
                  { at: 1, transform: { translateX: 100 } },
                ],
                durationMs: 1000,
                easing: "linear",
                fill: "both",
              },
            }
          : {}),
      },
      createElement("Path", {
        id: nodeId,
        width: 40,
        height: 40,
        d: "M20 0A20 20 0 1 1 20 40A20 20 0 1 1 20 0Z",
        fill: nodeId === "changed" ? "green" : "red",
        onClick: `${nodeId}-click`,
        onPointerMove: `${nodeId}-move`,
      }),
    ),
  );
}

/** Wait for committed browser rendering and two native animation frames. */
async function flushFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Mount a display through its real provider, then observe the generated DOM. */
async function mountDisplay(page: Page, mode: "interactive" | "static" | "animated") {
  await page.goto("/e2e-svg-dom-stability.html");
  await page.waitForFunction(() => typeof window.boundsvgSvgStability?.mount === "function");
  await page.evaluate(
    ({ scene, displayMode }) =>
      window.boundsvgSvgStability.mount(scene, {
        mode: displayMode,
        isAnimated: displayMode !== "static",
        ...(displayMode === "static" ? { timeMs: 500 } : {}),
      }),
    { scene: movingScene(), displayMode: mode },
  );
  await expect(page.locator("#mount svg").first()).toBeVisible();
  await flushFrames(page);
}

for (const mode of ["interactive", "static", "animated"] as const) {
  test(`${mode} preserves DOM and paused animation on a parent update`, async ({
    page,
  }, testInfo) => {
    await mountDisplay(page, mode);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = 500;
      }
    });
    await flushFrames(page);
    const before = await page.evaluate(() => window.boundsvgSvgStability.read());
    if (mode !== "static") {
      expect(before.animations.length).toBeGreaterThan(0);
    }
    if (mode === "interactive") {
      await page.mouse.move(170, 40);
      await flushFrames(page);
    }
    await page.evaluate(() => window.boundsvgSvgStability.update({ revision: 1 }));
    await flushFrames(page);
    const after = await page.evaluate(() => window.boundsvgSvgStability.read());
    await testInfo.attach("parent-and-hover-clock", {
      body: JSON.stringify({ before, after }),
      contentType: "application/json",
    });
    expect(after.svgId).toBe(before.svgId);
    expect(after.pathId).toBe(before.pathId);
    expect(after.animations).toEqual(before.animations);
    expect(after.pathRect).toEqual(before.pathRect);
    if (mode === "interactive") {
      expect(after.callbacks.some((delivery) => delivery.nodeId === "path")).toBe(true);
      expect(after.touchAction).toBe("none");
    }
  });
}

test("completed animation retains its clock across hover and clicks the red Path once", async ({
  page,
}, testInfo) => {
  await mountDisplay(page, "interactive");
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
  await flushFrames(page);
  const start = await page.evaluate(() => window.boundsvgSvgStability.read());
  expect(start.pathRect?.x).toBeCloseTo(100, 1);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.finish();
    }
  });
  await flushFrames(page);
  const before = await page.evaluate(() => window.boundsvgSvgStability.read());
  expect(before.pathRect?.x).toBeCloseTo(200, 1);
  expect(before.animations.every((animation) => animation.time === 1000)).toBe(true);
  await page.mouse.move(220, 40);
  await flushFrames(page);
  const hovered = await page.evaluate(() => window.boundsvgSvgStability.read());
  await page.mouse.click(220, 40);
  const clicked = await page.evaluate(() => window.boundsvgSvgStability.read());
  await testInfo.attach("paint-clock-pointer-timeline", {
    body: JSON.stringify({ start, before, hovered, clicked }),
    contentType: "application/json",
  });
  expect(hovered.svgId).toBe(before.svgId);
  expect(hovered.pathId).toBe(before.pathId);
  expect(hovered.animations).toEqual(before.animations);
  expect(hovered.pathRect).toEqual(before.pathRect);
  expect(clicked.callbacks.filter((delivery) => delivery.type === "click")).toEqual([
    expect.objectContaining({ nodeId: "path", generation: 0 }),
  ]);
});

test("new callbacks retain DOM while changed SVG updates IR, hit delivery and touch-action", async ({
  page,
}, testInfo) => {
  await mountDisplay(page, "interactive");
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 1000;
    }
  });
  await flushFrames(page);
  const before = await page.evaluate(() => window.boundsvgSvgStability.read());
  await page.evaluate(() => window.boundsvgSvgStability.update({ callbackGeneration: 1 }));
  await flushFrames(page);
  const callbacksUpdated = await page.evaluate(() => window.boundsvgSvgStability.read());
  expect(callbacksUpdated.svgId).toBe(before.svgId);
  expect(callbacksUpdated.animations).toEqual(before.animations);
  await page.mouse.click(220, 40);
  expect(
    await page.evaluate(() =>
      window.boundsvgSvgStability.read().callbacks.filter((delivery) => delivery.type === "click"),
    ),
  ).toEqual([expect.objectContaining({ nodeId: "path", generation: 1 })]);
  await page.evaluate(
    (scene) => {
      window.boundsvgSvgStability.clearCallbacks();
      window.boundsvgSvgStability.update({ vnode: scene, callbackGeneration: 2 });
    },
    movingScene("changed", false),
  );
  await expect(page.locator('#mount path[fill="green"]')).toBeVisible();
  await flushFrames(page);
  await page.mouse.click(200, 40);
  const changed = await page.evaluate(() => window.boundsvgSvgStability.read());
  await testInfo.attach("callback-and-scene-updates", {
    body: JSON.stringify({ before, callbacksUpdated, changed }),
    contentType: "application/json",
  });
  expect(changed.svgId).not.toBe(before.svgId);
  expect(changed.irNodeIds).toContain("changed");
  expect(changed.irNodeIds).not.toContain("path");
  expect(changed.touchAction).toBe("none");
  expect(changed.callbacks.filter((delivery) => delivery.type === "click")).toEqual([
    expect.objectContaining({ nodeId: "changed", generation: 2 }),
  ]);
});
