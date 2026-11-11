import {
  type AnimationSpec,
  Box,
  Canvas,
  createElement,
  Flex,
  Grid,
  type VNode,
} from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-live-interaction-harness.js";

/** These author dimensions and fixed points are independent of all native readouts. */
type PoseInput = {
  relation: "own" | "ancestor" | "clip";
  scaleX: number;
  scaleY: number;
  child?: "rotate" | "skew";
  animated?: boolean;
  delayMs?: number;
  fill?: "none" | "both";
};

/** Independent native B paint is later in IR order than the subject. */
function scene(input: PoseInput): VNode {
  const transform = { scaleX: input.scaleX, scaleY: input.scaleY, originX: 0, originY: 0 };
  const motion = {
    keyframes: [
      { at: 0, transform: { scaleX: input.scaleX, scaleY: input.scaleY } },
      { at: 1, transform: { scaleX: 2, scaleY: 2 } },
    ],
    durationMs: 800,
    delayMs: input.delayMs ?? 0,
    fill: input.fill ?? "both",
    easing: "linear",
  } satisfies AnimationSpec;
  const frame = createElement("Box", {
    id: "A",
    position: "absolute",
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    onClick: "select",
    onPointerEnter: "enter",
    onPointerLeave: "leave",
    onPointerMove: "move",
    ...(input.relation === "own"
      ? input.animated
        ? { transform, animate: motion }
        : { transform }
      : {
          transform: {
            ...(input.child === "rotate" ? { rotateDeg: 45 } : { skewYDeg: 20 }),
            originX: 50,
            originY: 50,
          },
        }),
  });
  const subject =
    input.relation === "own"
      ? frame
      : createElement(
          "Box",
          {
            id: "P",
            position: "absolute",
            left: 0,
            top: 0,
            width: 140,
            height: 140,
            ...(input.relation === "clip" ? { overflow: "clip" } : {}),
            ...(input.animated ? { transform, animate: motion } : { transform }),
          },
          frame,
        );
  return createElement(
    "Canvas",
    { width: 360, height: 180 },
    subject,
    createElement("Box", {
      id: "B",
      position: "absolute",
      left: 200,
      top: 20,
      width: 100,
      height: 100,
      background: "green",
      onClick: "other",
    }),
  );
}

/** Keep each producer's public function signature concrete instead of combining recursive generic props. */
function producerFrame(
  producer: "Canvas" | "Flex" | "Grid" | "Box",
  scale: number,
  isAnimated = false,
): VNode {
  const props = {
    id: "A",
    width: producer === "Canvas" ? 360 : 100,
    height: producer === "Canvas" ? 180 : 100,
    onClick: "select",
    transform: { scaleX: scale, scaleY: scale, originX: 0, originY: 0 },
    ...(isAnimated
      ? {
          animate: {
            keyframes: [
              { at: 0, transform: { scaleX: scale, scaleY: scale } },
              { at: 1, transform: { scaleX: 2, scaleY: 2 } },
            ],
            durationMs: 800,
            fill: "both",
            easing: "linear",
          } satisfies AnimationSpec,
        }
      : {}),
  };
  switch (producer) {
    case "Canvas":
      return Canvas({ id: "A", width: 360, height: 180, onClick: "select" });
    case "Flex":
      return Flex(props);
    case "Grid":
      return Grid(props);
    case "Box":
      return Box(props);
  }
}

/** Actual emitted animation/adapter commits settle without a synthetic input. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** One real Engine document per control; no geometry is projected by this harness. */
async function mount(
  page: Page,
  vnode: VNode,
  options: {
    adapter: "react" | "vanilla";
    animated?: boolean;
    scope?: "document" | "open" | "closed" | "slot" | "nested";
    reducedMotion?: "keep" | "pause";
  },
): Promise<void> {
  await page.evaluate(({ vnode, settings }) => window.boundsvgLive.mount(vnode, settings), {
    vnode,
    settings: { animated: false, scope: "document" as const, ...options },
  });
  await page.waitForFunction(
    () => window.boundsvgLive.read().ready || !!window.boundsvgLive.read().error,
  );
  expect(await page.evaluate(() => window.boundsvgLive.read().error)).toBeNull();
  await settle(page);
}

/** Record native coefficients as evidence; they never choose points or expected geometry. */
async function read(page: Page, x = 80, y = 80) {
  return page.evaluate(
    ({ x, y }) => {
      const carriers = [];
      let element = window.boundsvgLive.element('[data-boundsvg-node-id="A"]');
      while (element instanceof SVGGraphicsElement) {
        const matrix = element.getScreenCTM();
        carriers.push({
          tag: element.localName,
          id: element.getAttribute("data-boundsvg-node-id"),
          screen: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : null,
          css: getComputedStyle(element).transform,
        });
        element = element.parentElement;
      }
      return { observed: window.boundsvgLive.read(x, y), carriers };
    },
    { x, y },
  );
}

for (const adapter of ["react", "vanilla"] as const) {
  test(`${adapter} Flex and Grid Frames follow emitted zero, midpoint and final animation poses`, async ({
    page,
  }, testInfo) => {
    await page.goto("/e2e-live-interaction.html");
    await page.waitForFunction(() => !!window.boundsvgLive);
    for (const producer of ["Flex", "Grid"] as const) {
      await mount(page, Canvas({ width: 360, height: 180 }, producerFrame(producer, 0, true)), {
        adapter,
        animated: true,
      });
      for (const control of [
        { timeMs: 0, expected: null },
        { timeMs: 400, expected: "A" },
        { timeMs: 800, expected: "A" },
      ]) {
        expect(
          await page.evaluate((time) => window.boundsvgLive.seek(time), control.timeMs),
        ).toBeGreaterThan(0);
        await settle(page);
        const observation = await read(page);
        await testInfo.attach("control-observation", {
          body: JSON.stringify({ producer, control, observation }),
          contentType: "application/json",
        });
        expect(observation.observed.query).toMatchObject({
          status: "ready",
          hit: control.expected ? { nodeId: control.expected } : null,
        });
      }
    }
  });

  test(`${adapter} reduced motion keeps the authored zero underlying pose`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/e2e-live-interaction.html");
    await page.waitForFunction(() => !!window.boundsvgLive);
    const rows = [];
    for (const relation of ["own", "ancestor", "clip"] as const) {
      await mount(
        page,
        scene({ relation, scaleX: 0, scaleY: 0, child: "rotate", animated: true }),
        { adapter, animated: true, reducedMotion: "pause" },
      );
      const observation = await read(page);
      rows.push({ relation, observation });
      await testInfo.attach("control-observation", {
        body: JSON.stringify(rows.at(-1)),
        contentType: "application/json",
      });
      expect(observation.observed.animationTimes).toHaveLength(0);
      expect(observation.observed.query).toMatchObject({ status: "ready", hit: null });
    }
    await testInfo.attach("reduced-motion-underlying", {
      body: JSON.stringify(rows),
      contentType: "application/json",
    });
  });

  test(`${adapter} shares actual ancestry reads and delegates native representation admissibility`, async ({
    page,
  }, testInfo) => {
    await page.goto("/e2e-live-interaction.html");
    await page.waitForFunction(() => !!window.boundsvgLive);
    await mount(page, scene({ relation: "clip", scaleX: 1, scaleY: 1, child: "rotate" }), {
      adapter,
    });
    const counts = await page.evaluate(() => {
      const root = window.boundsvgLive.element("svg");
      if (!(root instanceof SVGSVGElement)) {
        throw new TypeError("Missing actual SVG");
      }
      const needed = new Set<Element>([root]);
      for (const id of ["A", "B", "P"]) {
        let element = window.boundsvgLive.element(`[data-boundsvg-node-id="${id}"]`);
        while (element && root.contains(element)) {
          needed.add(element);
          if (element === root) {
            break;
          }
          element = element.parentElement;
        }
      }
      const screens = new Map<Element, number>();
      const styles = new Map<Element, number>();
      const restorations: (() => void)[] = [];
      for (const element of needed) {
        const graphics = element as SVGGraphicsElement;
        const descriptor = Object.getOwnPropertyDescriptor(element, "getScreenCTM");
        const screen = graphics.getScreenCTM.bind(graphics);
        Object.defineProperty(element, "getScreenCTM", {
          configurable: true,
          value: () => {
            screens.set(element, (screens.get(element) ?? 0) + 1);
            return screen();
          },
        });
        restorations.push(() => {
          if (descriptor) {
            Object.defineProperty(element, "getScreenCTM", descriptor);
          } else {
            Reflect.deleteProperty(element, "getScreenCTM");
          }
        });
        if (typeof element.computedStyleMap === "function") {
          const styleDescriptor = Object.getOwnPropertyDescriptor(element, "computedStyleMap");
          const style = element.computedStyleMap.bind(element);
          Object.defineProperty(element, "computedStyleMap", {
            configurable: true,
            value: () => {
              styles.set(element, (styles.get(element) ?? 0) + 1);
              return style();
            },
          });
          restorations.push(() => {
            if (styleDescriptor) {
              Object.defineProperty(element, "computedStyleMap", styleDescriptor);
            } else {
              Reflect.deleteProperty(element, "computedStyleMap");
            }
          });
        }
      }
      const originalStyle = window.getComputedStyle;
      window.getComputedStyle = (element, pseudo) => {
        styles.set(element, (styles.get(element) ?? 0) + 1);
        return originalStyle.call(window, element, pseudo);
      };
      try {
        const observation = window.boundsvgLive.read(80, 80);
        return {
          observation,
          uniqueAncestry: needed.size,
          screens: [...screens.values()],
          styles: [...styles.values()],
        };
      } finally {
        window.getComputedStyle = originalStyle;
        for (const restore of restorations.reverse()) {
          restore();
        }
      }
    });
    expect(counts.observation.query).toMatchObject({ status: "ready", hit: { nodeId: "A" } });
    expect(counts.screens.length).toBeGreaterThan(0);
    expect(counts.styles.length).toBeGreaterThan(0);
    expect(counts.screens.every((count) => count === 1)).toBe(true);
    expect(counts.styles.every((count) => count === 1)).toBe(true);
    expect(counts.screens.length).toBeLessThanOrEqual(counts.uniqueAncestry);
    expect(counts.styles.length).toBeLessThanOrEqual(counts.uniqueAncestry);
    const rows = [];
    await mount(page, scene({ relation: "own", scaleX: 1, scaleY: 1 }), { adapter });
    for (const transform of [
      "none",
      "scale(1)",
      "translateZ(0)",
      "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)",
      "perspective(1000px)",
    ]) {
      const observation = await page.evaluate((transform) => {
        const element = window.boundsvgLive.element('[data-boundsvg-node-id="A"]');
        if (!(element instanceof SVGGraphicsElement)) {
          throw new TypeError("Missing actual Frame");
        }
        element.style.transform = transform;
        let isAdmitted: boolean;
        if (typeof element.computedStyleMap === "function") {
          const value = element.computedStyleMap().get("transform");
          isAdmitted =
            !!value &&
            (("value" in value && value.value === "none") ||
              ("is2D" in value &&
                value.is2D === true &&
                "toMatrix" in value &&
                typeof value.toMatrix === "function" &&
                value.toMatrix().is2D === true));
        } else {
          const css = getComputedStyle(element).transform;
          isAdmitted = css === "none" || new DOMMatrixReadOnly(css).is2D;
        }
        return { transform, isAdmitted, observed: window.boundsvgLive.read(80, 80) };
      }, transform);
      rows.push(observation);
      await testInfo.attach("control-observation", {
        body: JSON.stringify(rows.at(-1)),
        contentType: "application/json",
      });
      expect(observation.observed.query?.status).toBe(
        observation.isAdmitted ? "ready" : "unavailable",
      );
    }
    await testInfo.attach("native-reads-and-representations", {
      body: JSON.stringify({
        counts,
        rows,
        matrixConversionCount:
          "bounded structurally by one native conversion per local style read; direct unit counters are separate",
      }),
      contentType: "application/json",
    });
  });

  test(`${adapter} formal own, compound ancestor and clip-owner zero/double poses`, async ({
    page,
  }, testInfo) => {
    await page.goto("/e2e-live-interaction.html");
    await page.waitForFunction(() => !!window.boundsvgLive);
    const rows = [];
    for (const relation of ["own", "ancestor", "clip"] as const) {
      for (const child of relation === "own"
        ? (["rotate"] as const)
        : (["rotate", "skew"] as const)) {
        for (const scales of [
          [0, 1],
          [1, 0],
          [0, 0],
          [2, 2],
        ] as const) {
          const input: PoseInput = { relation, child, scaleX: scales[0], scaleY: scales[1] };
          const isPositive = scales[0] === 2;
          await mount(page, scene(input), { adapter });
          const observation = await read(page);
          rows.push({ input, observation });
          await testInfo.attach("control-observation", {
            body: JSON.stringify(rows.at(-1)),
            contentType: "application/json",
          });
          expect(observation.observed.query).toMatchObject({
            status: "ready",
            hit: isPositive ? { nodeId: "A" } : null,
          });
          await page.mouse.click(80, 80);
          expect(
            (await read(page)).observed.deliveries.filter(
              (delivery) => delivery.handlerName === "select",
            ),
          ).toHaveLength(isPositive ? 1 : 0);
          expect((await read(page, 250, 70)).observed.query).toMatchObject({
            status: "ready",
            hit: { nodeId: "B" },
          });
        }
      }
    }
    await testInfo.attach("formal-current-poses", {
      body: JSON.stringify({ point: [80, 80], otherPoint: [250, 70], rows }),
      contentType: "application/json",
    });
  });

  test(`${adapter} producer Frames preserve nonzero tiny and balanced poses in every owned scope`, async ({
    page,
  }, testInfo) => {
    await page.goto("/e2e-live-interaction.html");
    await page.waitForFunction(() => !!window.boundsvgLive);
    const rows = [];
    for (const producer of ["Canvas", "Flex", "Grid", "Box"] as const) {
      for (const scale of producer === "Canvas" ? [1] : [0, 2]) {
        const frame = producerFrame(producer, scale);
        const vnode =
          producer === "Canvas"
            ? frame
            : createElement("Canvas", { width: 360, height: 180 }, frame);
        await mount(page, vnode, { adapter });
        const observation = await read(page);
        rows.push({ producer, scale, observation });
        await testInfo.attach("control-observation", {
          body: JSON.stringify(rows.at(-1)),
          contentType: "application/json",
        });
        expect(observation.observed.query).toMatchObject({
          status: "ready",
          hit: scale === 0 ? null : { nodeId: "A" },
        });
      }
    }
    for (const scope of ["document", "open", "closed", "slot", "nested"] as const) {
      const zero = scene({ relation: "clip", scaleX: 0, scaleY: 1, child: "rotate" });
      await mount(page, zero, { adapter, scope });
      const observation = await read(page);
      rows.push({ scope, observation });
      await testInfo.attach("control-observation", {
        body: JSON.stringify(rows.at(-1)),
        contentType: "application/json",
      });
      expect(observation.observed.query).toMatchObject({ status: "ready", hit: null });
    }
    for (const tiny of [1e-10, 2 ** -40]) {
      for (const mode of ["attribute", "css-transform"] as const) {
        const frame = createElement("Box", {
          id: "A",
          position: "absolute",
          width: 100,
          height: 100,
          onClick: "select",
          transform: { scaleX: tiny, scaleY: 1, originX: 0, originY: 0 },
        });
        const vnode = createElement(
          "Canvas",
          { width: 360, height: 180 },
          createElement(
            "Box",
            {
              width: 120,
              height: 140,
              transform: { scaleX: 1 / tiny, scaleY: 1, originX: 0, originY: 0 },
            },
            frame,
          ),
        );
        await mount(page, vnode, { adapter });
        if (mode === "css-transform") {
          await page.evaluate((tiny) => {
            const element = window.boundsvgLive.element('[data-boundsvg-node-id="A"]');
            if (!(element instanceof SVGGraphicsElement)) {
              throw new TypeError("Missing actual Frame");
            }
            element.style.transform = `scale(${tiny}, 1)`;
          }, tiny);
          await settle(page);
        }
        const observation = await read(page);
        rows.push({ tiny, mode, observation });
        await testInfo.attach("control-observation", {
          body: JSON.stringify(rows.at(-1)),
          contentType: "application/json",
        });
        expect(observation.observed.query).toMatchObject({ status: "ready", hit: { nodeId: "A" } });
      }
    }
    await testInfo.attach("producer-scope-precision", {
      body: JSON.stringify({ point: [80, 80], rows }),
      contentType: "application/json",
    });
  });

  for (const relation of ["own", "ancestor", "clip"] as const) {
    test(`${adapter} native animation states retain empty evidence and stationary hover (${relation})`, async ({
      page,
    }, testInfo) => {
      await page.goto("/e2e-live-interaction.html");
      await page.waitForFunction(() => !!window.boundsvgLive);
      const rows = [];
      for (const child of relation === "own"
        ? (["rotate"] as const)
        : (["rotate", "skew"] as const)) {
        for (const axis of ["x", "y", "both"] as const) {
          for (const fill of ["none", "both"] as const) {
            const input: PoseInput = {
              relation,
              child,
              scaleX: axis === "y" ? 1 : 0,
              scaleY: axis === "x" ? 1 : 0,
              animated: true,
              delayMs: 200,
              fill,
            };
            await mount(page, scene(input), { adapter, animated: true });
            await page.mouse.move(80, 80);
            await settle(page);
            await page.evaluate(() => window.boundsvgLive.clear());
            for (const state of [
              { name: "delay", time: 0, expected: null },
              { name: "active-zero", time: 200, expected: null },
              { name: "midpoint", time: 600, expected: "A" },
              { name: "finished", time: 1000, expected: fill === "both" ? "A" : null },
            ]) {
              expect(
                await page.evaluate((time) => window.boundsvgLive.seek(time), state.time),
              ).toBeGreaterThan(0);
              await settle(page);
              const observation = await read(page);
              rows.push({ input, state, observation });
              await testInfo.attach("control-observation", {
                body: JSON.stringify(rows.at(-1)),
                contentType: "application/json",
              });
              expect(observation.observed.query).toMatchObject({
                status: "ready",
                hit: state.expected ? { nodeId: state.expected } : null,
              });
              expect(observation.observed.hover).toBe(state.expected);
            }
            await page.evaluate(
              (time) => {
                for (const animation of window.boundsvgLive
                  .element("svg")
                  ?.getAnimations({ subtree: true }) ?? []) {
                  animation.playbackRate = -1;
                  animation.pause();
                  animation.currentTime = time;
                }
              },
              axis === "both" ? 300 : 210,
            );
            await settle(page);
            const reversed = await read(page);
            rows.push({ input, state: "reverse-paused-early", reversed });
            await testInfo.attach("control-observation", {
              body: JSON.stringify(rows.at(-1)),
              contentType: "application/json",
            });
            expect(reversed.observed.query).toMatchObject({ status: "ready", hit: null });
            await page.evaluate(() => {
              for (const animation of window.boundsvgLive
                .element("svg")
                ?.getAnimations({ subtree: true }) ?? []) {
                animation.cancel();
              }
            });
            await settle(page);
            const cancelled = await read(page);
            rows.push({ input, state: "cancelled-underlying", cancelled });
            await testInfo.attach("control-observation", {
              body: JSON.stringify(rows.at(-1)),
              contentType: "application/json",
            });
            expect(cancelled.observed.query).toMatchObject({ status: "ready", hit: null });
            await mount(page, scene(input), { adapter, animated: true });
            await page.mouse.move(80, 80);
            await page.evaluate(() => window.boundsvgLive.seek(200));
            await settle(page);
            await page.evaluate(() => window.boundsvgLive.clear());
            await page.evaluate(async () => {
              const animations =
                window.boundsvgLive.element("svg")?.getAnimations({ subtree: true }) ?? [];
              for (const animation of animations) {
                animation.playbackRate = 4;
                animation.play();
              }
              await Promise.all(animations.map((animation) => animation.finished));
            });
            await settle(page);
            const natural = await read(page);
            rows.push({ input, state: "natural-finished", natural });
            await testInfo.attach("control-observation", {
              body: JSON.stringify(rows.at(-1)),
              contentType: "application/json",
            });
            expect(natural.observed.query).toMatchObject({
              status: "ready",
              hit: fill === "both" ? { nodeId: "A" } : null,
            });
            expect(
              natural.observed.deliveries.filter((delivery) => delivery.handlerName === "move"),
            ).toHaveLength(0);
          }
        }
      }
      await testInfo.attach("native-animation-pose-states", {
        body: JSON.stringify({ point: [80, 80], noSyntheticMoveDuringSeek: true, rows }),
        contentType: "application/json",
      });
    });
  }
}
