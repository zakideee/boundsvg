import { createElement, type VNode } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-live-interaction-harness.js";

/** Every callback group is observable without adding a dispatcher to the page. */
const REFERENCES = {
  onClick: "click",
  onPointerEnter: "enter",
  onPointerOver: "over",
  onPointerLeave: "leave",
  onPointerOut: "out",
  onPointerDown: "down",
  onPointerUp: "up",
  onPointerCancel: "cancel",
  onPointerMove: "move",
};
/** Source geometry and callbacks are independent of native query results. */
function frames(first = "A", count = 1): VNode {
  return createElement(
    "Canvas",
    { width: 360, height: 180 },
    ...Array.from({ length: count }, (_, ordinal) =>
      createElement("Box", {
        id: ordinal === 0 ? first : "other",
        position: "absolute",
        left: 20 + ordinal * 140,
        top: 20,
        width: 100,
        height: 100,
        ...REFERENCES,
      }),
    ),
  );
}
/** Two native frames settle a commit/seek without sampling a separate scene clock. */
async function flush(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
/** Actual adapter mount; delayed React mount is handled explicitly by its caller. */
async function mount(
  page: Page,
  input: VNode,
  options: Partial<Parameters<Window["boundsvgLive"]["mount"]>[1]> = {},
): Promise<void> {
  await page.goto("/e2e-live-interaction.html");
  await page.waitForFunction(() => !!window.boundsvgLive);
  await page.evaluate(({ vnode, settings }) => window.boundsvgLive.mount(vnode, settings), {
    vnode: input,
    settings: { adapter: "react", scope: "document", animated: false, ...options },
  });
  if (!options.delayed) {
    await page.waitForFunction(
      () => window.boundsvgLive.read().ready || window.boundsvgLive.read().error !== null,
    );
    expect(await page.evaluate(() => window.boundsvgLive.read().error)).toBeNull();
  }
  await flush(page);
}

for (const adapter of ["react", "vanilla"] as const) {
  test(`${adapter} a real MouseEvent remains the input cause after primary pointer tracking`, async ({
    page,
  }, testInfo) => {
    await mount(page, frames("A", 2), { adapter });
    await page.mouse.move(50, 50);
    await flush(page);
    await page.evaluate(() => {
      window.boundsvgLive.clear();
      window.boundsvgLive
        .element("svg")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, clientX: 190, clientY: 50 }),
        );
    });
    const observed = await page.evaluate(() => window.boundsvgLive.read());
    await testInfo.attach("mouse-input-cause", {
      body: JSON.stringify(observed),
      contentType: "application/json",
    });
    expect(observed.deliveries.filter((delivery) => delivery.handlerName === "enter")).toEqual([
      expect.objectContaining({ nodeId: "other", cause: "input", nativeType: "click" }),
    ]);
    expect(observed.deliveries.filter((delivery) => delivery.handlerName === "click")).toHaveLength(
      1,
    );
  });

  for (const terminal of ["ownedUp", "unownedUp", "cancel"] as const) {
    for (const isCompatible of [false, true]) {
      test(`${adapter} primary touch ${terminal} clears once across a synchronous commit (compatible=${isCompatible})`, async ({
        page,
      }, testInfo) => {
        const touchScene = (id: string): VNode => {
          const input = frames(id);
          const child = input.children[0];
          if (typeof child !== "object" || child === null) {
            throw new Error("Missing authored Frame");
          }
          child.props.onTouchStart = "touchStart";
          child.props.onTouchEnd = "touchEnd";
          return input;
        };
        await mount(page, touchScene("A"), { adapter });
        await page.evaluate(
          ({ next, terminal }) => {
            const root = window.boundsvgLive.element("svg");
            if (!root) {
              throw new Error("Missing committed SVG");
            }
            const input = (type: string, pointerId = 71) =>
              root.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  composed: true,
                  isPrimary: true,
                  pointerType: "touch",
                  pointerId,
                  clientX: 50,
                  clientY: 50,
                }),
              );
            input("pointerdown");
            window.boundsvgLive.clear();
            let committed = false;
            window.boundsvgLive.setDeliveryHook((delivery) => {
              if (
                !committed &&
                (delivery.handlerName === "up" || delivery.handlerName === "cancel")
              ) {
                committed = true;
                window.boundsvgLive.update(next, { flush: true });
              }
            });
            input(
              terminal === "cancel" ? "pointercancel" : "pointerup",
              terminal === "unownedUp" ? 72 : 71,
            );
            window.boundsvgLive.setDeliveryHook(null);
          },
          { next: touchScene(isCompatible ? "A" : "other"), terminal },
        );
        await flush(page);
        const observed = await page.evaluate(() => window.boundsvgLive.read());
        await testInfo.attach("touch-terminal-reentry", {
          body: JSON.stringify({ terminal, isCompatible, observed }),
          contentType: "application/json",
        });
        expect(observed.error).toBeNull();
        expect(
          observed.deliveries.filter((delivery) => delivery.handlerName === "enter"),
        ).toHaveLength(0);
        expect(
          observed.deliveries.filter((delivery) => delivery.handlerName === "leave"),
        ).toHaveLength(1);
        expect(observed.hover).toBeNull();
        expect(observed.hoverChanges).toEqual(["A", null]);
        if (terminal === "ownedUp") {
          expect(
            observed.deliveries.filter((delivery) => delivery.handlerName === "touchEnd"),
          ).toEqual([expect.objectContaining({ generation: 0, nativeType: "pointerup" })]);
        }
      });
    }
  }

  for (const isCompatible of [false, true]) {
    test(`${adapter} departing hover uses its mapped callback when the target changes (compatible=${isCompatible})`, async ({
      page,
    }, testInfo) => {
      const old = frames("A", 2);
      await mount(page, old, { adapter });
      await page.mouse.move(50, 50);
      await flush(page);
      const next = frames(isCompatible ? "A" : "C", 2);
      for (const [ordinal, child] of next.children.entries()) {
        if (typeof child === "object" && child !== null) {
          child.props.left = ordinal === 0 ? 160 : 20;
        }
      }
      await page.evaluate((next) => {
        window.boundsvgLive.clear();
        window.boundsvgLive.update(next, { flush: true });
      }, next);
      await flush(page);
      const observed = await page.evaluate(() => window.boundsvgLive.read());
      await testInfo.attach("mapped-hover-departure", {
        body: JSON.stringify({ isCompatible, observed }),
        contentType: "application/json",
      });
      expect(observed.error).toBeNull();
      expect(observed.deliveries.filter((delivery) => delivery.handlerName === "leave")).toEqual([
        expect.objectContaining({ nodeId: "A", generation: isCompatible ? 1 : 0 }),
      ]);
      expect(observed.hover).toBe("other");
    });
  }

  test(`${adapter} automatic Text menu retains its input snapshot across an enter-triggered commit`, async ({
    page,
  }, testInfo) => {
    const textInput = (label: string): VNode =>
      createElement(
        "Canvas",
        { width: 360, height: 180 },
        createElement(
          "Text",
          {
            id: "label",
            position: "absolute",
            left: 100,
            top: 22,
            width: 100,
            height: 100,
            font: "Test",
            fontSizePx: 64,
            color: "black",
            onPointerEnter: "enter",
          },
          label,
        ),
      );
    await mount(page, textInput("H"), { adapter });
    const before = await page.evaluate(() => window.boundsvgLive.read(130, 60));
    expect(before.nativeSource).toBe("label");
    expect(before.menus).toHaveLength(0);
    await page.evaluate((next) => {
      let changed = false;
      window.boundsvgLive.setDeliveryHook((delivery) => {
        if (!changed && delivery.handlerName === "enter") {
          changed = true;
          window.boundsvgLive.update(next, { flush: true });
        }
      });
      const root = window.boundsvgLive.element("svg");
      if (!root) {
        throw new Error("Missing committed SVG");
      }
      root.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          composed: true,
          cancelable: true,
          clientX: 130,
          clientY: 60,
        }),
      );
      window.boundsvgLive.setDeliveryHook(null);
    }, textInput("HH"));
    const after = await page.evaluate(() => window.boundsvgLive.read(130, 60));
    await testInfo.attach("text-menu-input-snapshot", {
      body: JSON.stringify({ adapter, before, after }),
      contentType: "application/json",
    });
    expect(after.error).toBeNull();
    expect(after.menus).toEqual([
      expect.objectContaining({ nodeId: "label", nodeText: "H", lineText: "H" }),
    ]);
  });

  test(`${adapter} records external individual zero-scale outside the semantic Frame guarantee`, async ({
    page,
  }, testInfo) => {
    const input = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement(
        "Box",
        {
          id: "A",
          position: "absolute",
          left: 20,
          top: 20,
          width: 100,
          height: 100,
          ...REFERENCES,
        },
        createElement("Box", { id: "ink", width: 100, height: 100, background: "red" }),
      ),
    );
    await mount(page, input, { adapter });
    const matrix = await page.evaluate(() => {
      const endpoint = window.boundsvgLive.element('[data-boundsvg-node-id="A"]');
      if (!(endpoint instanceof SVGGraphicsElement)) {
        throw new Error("Missing Frame endpoint");
      }
      endpoint.style.scale = "0";
      const pose = endpoint.getScreenCTM();
      return pose ? [pose.a, pose.b, pose.c, pose.d, pose.e, pose.f] : null;
    });
    const snapshot = await page.evaluate(() => window.boundsvgLive.read(50, 50));
    await flush(page);
    const settled = await page.evaluate(() => {
      const endpoint = window.boundsvgLive.element('[data-boundsvg-node-id="A"]');
      if (!(endpoint instanceof SVGGraphicsElement)) {
        throw new Error("Missing Frame endpoint");
      }
      const screen = endpoint.getScreenCTM();
      const local = endpoint.getCTM();
      const rectangle = endpoint.getBoundingClientRect();
      return {
        screen: screen ? [screen.a, screen.b, screen.c, screen.d, screen.e, screen.f] : null,
        local: local ? [local.a, local.b, local.c, local.d, local.e, local.f] : null,
        computedScale: getComputedStyle(endpoint).scale,
        nativeBBox: {
          x: rectangle.x,
          y: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
        },
        observation: window.boundsvgLive.read(50, 50),
      };
    });
    await page.mouse.click(50, 50);
    const callbacks = await page.evaluate(() =>
      window.boundsvgLive.read().deliveries.filter((delivery) => delivery.handlerName === "click"),
    );
    await testInfo.attach("individual-zero-scale", {
      body: JSON.stringify({ matrix, snapshot, settled, callbacks }),
      contentType: "application/json",
    });
    // Individual longhands are outside Frame pose guarantees; native paint remains authoritative.
    for (const observation of [snapshot, settled.observation]) {
      if (observation.nativeSource === "ink") {
        expect(observation.query).toMatchObject({ status: "ready", hit: { nodeId: "ink" } });
      }
    }
    expect(callbacks).toHaveLength(snapshot.query.status === "ready" && snapshot.query.hit ? 1 : 0);
    if (callbacks.length) {
      expect(callbacks[0]).toMatchObject({ nodeId: "A" });
    }
  });

  test(`${adapter} native reverse/rate/pause/resume/finish/cancel retain same-SVG clock and emit no moves`, async ({
    page,
  }, testInfo) => {
    const input = createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement("Box", {
        id: "A",
        position: "absolute",
        left: 20,
        top: 20,
        width: 100,
        height: 100,
        ...REFERENCES,
        animate: {
          keyframes: [
            { at: 0, transform: { translateX: 0 } },
            { at: 1, transform: { translateX: 120 } },
          ],
          durationMs: 1000,
          easing: "linear",
          fill: "both",
        },
      }),
    );
    await mount(page, input, { adapter, animated: true, rerenderOnHover: true });
    expect(await page.evaluate(() => window.boundsvgLive.seek(0))).toBeGreaterThan(0);
    await flush(page);
    await page.mouse.move(50, 50);
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read().hover)).toBe("A");
    await page.evaluate(() => {
      const root = window.boundsvgLive.element("svg");
      const animation = root?.getAnimations({ subtree: true })[0];
      if (!root || !animation) {
        throw new Error("Missing live clock");
      }
      Object.assign(window, { savedLiveClock: { root, animation, time: animation.currentTime } });
      window.boundsvgLive.clear();
      window.boundsvgLive.update(null, { flush: true });
    });
    await flush(page);
    expect(
      await page.evaluate(() => {
        const saved = (
          window as Window & {
            savedLiveClock: { root: Element; animation: Animation; time: CSSNumberish | null };
          }
        ).savedLiveClock;
        return (
          saved.root === window.boundsvgLive.element("svg") &&
          saved.animation === saved.root.getAnimations({ subtree: true })[0] &&
          saved.animation.currentTime === saved.time
        );
      }),
    ).toBe(true);
    await page.evaluate(() => window.boundsvgLive.seek(1000));
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read().hover)).toBeNull();
    await page.evaluate(() => {
      for (const animation of window.boundsvgLive
        .element("svg")
        ?.getAnimations({ subtree: true }) ?? []) {
        animation.reverse();
        animation.playbackRate = -4;
      }
    });
    await expect.poll(() => page.evaluate(() => window.boundsvgLive.read().hover)).toBe("A");
    await page.evaluate(() => {
      for (const animation of window.boundsvgLive
        .element("svg")
        ?.getAnimations({ subtree: true }) ?? []) {
        animation.pause();
        animation.playbackRate = 1;
        animation.currentTime = 500;
      }
    });
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read().hover)).toBeNull();
    await page.evaluate(() => {
      for (const animation of window.boundsvgLive
        .element("svg")
        ?.getAnimations({ subtree: true }) ?? []) {
        animation.play();
        animation.finish();
      }
    });
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read().hover)).toBeNull();
    await page.evaluate(() => {
      for (const animation of window.boundsvgLive
        .element("svg")
        ?.getAnimations({ subtree: true }) ?? []) {
        animation.cancel();
      }
    });
    await flush(page);
    const result = await page.evaluate(() => window.boundsvgLive.read());
    expect(result.hover).toBe("A");
    expect(result.deliveries.filter((delivery) => delivery.handlerName === "move")).toHaveLength(0);
    expect(
      result.deliveries.every(
        (delivery) => delivery.cause === "scene" && delivery.nativeType === null,
      ),
    ).toBe(true);
    await testInfo.attach("native-clock-operations", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
  });

  test(`${adapter} a started enter group completes before the latest scene enters`, async ({
    page,
  }, testInfo) => {
    await mount(page, frames(), { adapter });
    await page.evaluate(
      (next) =>
        window.boundsvgLive.setDeliveryHook((delivery) => {
          if (delivery.nodeId === "A" && delivery.handlerName === "enter") {
            window.boundsvgLive.update(next, { flush: true });
          }
        }),
      frames("replacement"),
    );
    await page.mouse.move(50, 50);
    await flush(page);
    const snapshot = await page.evaluate(() => window.boundsvgLive.read());
    const entries = snapshot.deliveries.filter(
      (delivery) => delivery.handlerName === "enter" || delivery.handlerName === "over",
    );
    expect(
      entries
        .slice(0, 2)
        .map((delivery) => `${delivery.nodeId}:${delivery.handlerName}:${delivery.generation}`),
    ).toEqual(["A:enter:0", "A:over:0"]);
    expect(entries).toContainEqual(
      expect.objectContaining({
        nodeId: "replacement",
        handlerName: "enter",
        cause: "scene",
        generation: 1,
      }),
    );
    expect(snapshot.hover).toBe("replacement");
    await testInfo.attach("started-group-trace", {
      body: JSON.stringify(snapshot),
      contentType: "application/json",
    });
  });

  test(`${adapter} reentrant down keeps its old obligation and cancels exactly once`, async ({
    page,
  }, testInfo) => {
    await mount(page, frames(), { adapter });
    await page.mouse.move(50, 50);
    await flush(page);
    await page.evaluate((next) => {
      window.boundsvgLive.clear();
      window.boundsvgLive.setDeliveryHook((delivery) => {
        if (delivery.nodeId === "A" && delivery.handlerName === "down") {
          window.boundsvgLive.update(next, { flush: true });
        }
      });
    }, frames("replacement"));
    await page.mouse.down();
    await flush(page);
    await page.mouse.up();
    const snapshot = await page.evaluate(() => window.boundsvgLive.read());
    expect(
      snapshot.deliveries.filter(
        (delivery) => delivery.nodeId === "A" && delivery.handlerName === "down",
      ),
    ).toHaveLength(1);
    expect(
      snapshot.deliveries.filter(
        (delivery) => delivery.nodeId === "A" && delivery.handlerName === "cancel",
      ),
    ).toEqual([expect.objectContaining({ generation: 0, cause: "scene", nativeType: null })]);
    expect(
      snapshot.deliveries.filter(
        (delivery) => delivery.nodeId === "replacement" && delivery.handlerName === "up",
      ),
    ).toHaveLength(1);
    await testInfo.attach("down-terminal-trace", {
      body: JSON.stringify(snapshot),
      contentType: "application/json",
    });
  });

  test(`${adapter} actual node disposal stops the remainder of a started group`, async ({
    page,
  }) => {
    await mount(page, frames(), { adapter });
    await page.evaluate(() =>
      window.boundsvgLive.setDeliveryHook((delivery) => {
        if (delivery.handlerName === "enter") {
          window.boundsvgLive.unmount();
        }
      }),
    );
    await page.mouse.move(50, 50);
    expect(
      await page.evaluate(() =>
        window.boundsvgLive.read().deliveries.map((delivery) => delivery.handlerName),
      ),
    ).toEqual(["enter"]);
  });

  test(`${adapter} full duplicate topology insertion closes the old down owner`, async ({
    page,
  }, testInfo) => {
    const duplicate = (count: number) =>
      createElement(
        "Canvas",
        { width: 360, height: 180 },
        ...Array.from({ length: count }, () =>
          createElement("Box", {
            position: "absolute",
            left: 20,
            top: 20,
            width: 100,
            height: 100,
            ...REFERENCES,
          }),
        ),
      );
    await mount(page, duplicate(2), { adapter });
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.evaluate((next) => {
      window.boundsvgLive.clear();
      window.boundsvgLive.update(next, { flush: true });
    }, duplicate(3));
    await flush(page);
    await page.mouse.up();
    const snapshot = await page.evaluate(() => window.boundsvgLive.read());
    expect(snapshot.deliveries.filter((delivery) => delivery.handlerName === "cancel")).toEqual([
      expect.objectContaining({ generation: 0, cause: "scene" }),
    ]);
    expect(snapshot.deliveries).toContainEqual(
      expect.objectContaining({ handlerName: "leave", generation: 0 }),
    );
    expect(snapshot.deliveries).toContainEqual(
      expect.objectContaining({ handlerName: "enter", generation: 1 }),
    );
    await testInfo.attach("duplicate-topology-trace", {
      body: JSON.stringify(snapshot),
      contentType: "application/json",
    });
  });

  test(`${adapter} native capture loss keeps ownership until an observed release`, async ({
    page,
  }) => {
    await mount(page, frames(), { adapter });
    await page.evaluate(() =>
      window.boundsvgLive.setDeliveryHook((delivery) => {
        if (delivery.handlerName === "down" && delivery.pointerId !== null) {
          window.boundsvgLive.element("svg")?.setPointerCapture(delivery.pointerId);
        }
      }),
    );
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.evaluate(() => {
      const down = window.boundsvgLive
        .read()
        .deliveries.find((delivery) => delivery.handlerName === "down");
      if (down?.pointerId === null || down?.pointerId === undefined) {
        throw new Error("Missing pointer identity");
      }
      window.boundsvgLive.element("svg")?.releasePointerCapture(down.pointerId);
    });
    await flush(page);
    expect(
      await page.evaluate(() =>
        window.boundsvgLive
          .read()
          .deliveries.filter((delivery) => delivery.handlerName === "cancel"),
      ),
    ).toHaveLength(0);
    await page.mouse.move(400, 240);
    await page.mouse.up();
    expect(
      await page.evaluate(() =>
        window.boundsvgLive
          .read()
          .deliveries.filter((delivery) => delivery.handlerName === "cancel"),
      ),
    ).toHaveLength(1);
  });

  test(`${adapter} transition, host affine pose, zero root and detach keep distinct meanings`, async ({
    page,
  }, testInfo) => {
    await mount(page, frames(), { adapter, animated: true });
    await page.evaluate(async () => {
      const endpoint = window.boundsvgLive.element('[data-boundsvg-node-id="A"]');
      if (!(endpoint instanceof SVGElement)) {
        throw new Error("Missing endpoint");
      }
      endpoint.style.transition = "transform 80ms linear";
      endpoint.getBoundingClientRect();
      endpoint.style.transform = "translateX(120px)";
      await Promise.all(endpoint.getAnimations().map((animation) => animation.finished));
    });
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read(50, 50).query)).toMatchObject({
      status: "ready",
      hit: null,
    });
    expect(await page.evaluate(() => window.boundsvgLive.read(170, 50).query)).toMatchObject({
      status: "ready",
      hit: { nodeId: "A" },
    });
    await page.evaluate(() => {
      const root = window.boundsvgLive.element("svg");
      if (!root?.parentElement) {
        throw new Error("Missing host");
      }
      root.parentElement.style.transform = "translateX(60px)";
    });
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read(230, 50).query)).toMatchObject({
      status: "ready",
      hit: { nodeId: "A" },
    });
    const detached = await page.evaluate(() => window.boundsvgLive.queryDetached());
    expect(detached).toEqual({ status: "unavailable", reason: "detached" });
    const zero = await page.evaluate(() => {
      const root = window.boundsvgLive.element("svg");
      if (!(root instanceof SVGSVGElement)) {
        throw new Error("Missing SVG");
      }
      root.style.scale = "0";
      const matrix = root.getScreenCTM();
      return {
        matrix: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : null,
        observation: window.boundsvgLive.read(50, 50),
      };
    });
    const result = zero.observation.query;
    if (result?.status === "ready") {
      expect(result.hit).toBeNull();
    } else {
      expect(result).toEqual({ status: "unavailable", reason: "coordinatesUnavailable" });
    }
    await testInfo.attach("pose-failure-states", {
      body: JSON.stringify({ detached, zero }),
      contentType: "application/json",
    });
  });
}

test("actual adapter RAF structure is static idle zero and animated at most one", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const active = new Set<number>();
    let peak = 0;
    window.requestAnimationFrame = (callback) => {
      const id = request((timestamp) => {
        active.delete(id);
        callback(timestamp);
      });
      active.add(id);
      peak = Math.max(peak, active.size);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      active.delete(id);
      cancel(id);
    };
    Object.assign(window, {
      interactionRafMeter: {
        reset() {
          peak = active.size;
        },
        read() {
          return { active: active.size, peak };
        },
      },
    });
  });
  const observations = [];
  for (const adapter of ["react", "vanilla"] as const) {
    for (const animated of [false, true]) {
      await mount(page, frames(), { adapter, animated });
      await page.evaluate(() =>
        (
          window as Window & { interactionRafMeter: { reset: () => void } }
        ).interactionRafMeter.reset(),
      );
      await page.mouse.move(50, 50);
      await page.waitForTimeout(80);
      const meter = await page.evaluate(() =>
        (
          window as Window & {
            interactionRafMeter: { read: () => { active: number; peak: number } };
          }
        ).interactionRafMeter.read(),
      );
      expect(meter.active).toBe(animated ? 1 : 0);
      expect(meter.peak).toBeLessThanOrEqual(1);
      observations.push({ adapter, animated, meter });
      await page.evaluate(() => window.boundsvgLive.unmount());
      expect(
        await page.evaluate(
          () =>
            (
              window as Window & { interactionRafMeter: { read: () => { active: number } } }
            ).interactionRafMeter.read().active,
        ),
      ).toBe(0);
    }
  }
  await testInfo.attach("RAF-structure", {
    body: JSON.stringify(observations),
    contentType: "application/json",
  });
});

test("React delayed mount, inline hover state, handler-only and fill-only updates keep their owners", async ({
  page,
}, testInfo) => {
  const painted = (fill: string, outline = false) =>
    createElement(
      "Canvas",
      { width: 360, height: 180 },
      createElement("Box", {
        id: "paint",
        position: "absolute",
        left: 20,
        top: 20,
        width: 100,
        height: 100,
        background: fill,
        ...(outline ? { outline: { stroke: "black", strokeWidth: 4 } } : {}),
        ...REFERENCES,
      }),
    );
  await mount(page, painted("red"), { adapter: "react", delayed: true, rerenderOnHover: true });
  expect(await page.evaluate(() => window.boundsvgLive.read().ready)).toBe(false);
  await page.evaluate(() => window.boundsvgLive.update(null, { visible: true, flush: true }));
  await page.waitForFunction(() => window.boundsvgLive.read().ready);
  await page.evaluate(() => {
    (window as Window & { initialRoot: Element | null }).initialRoot =
      window.boundsvgLive.element("svg");
  });
  await page.mouse.move(50, 50);
  await flush(page);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { initialRoot: Element | null }).initialRoot ===
        window.boundsvgLive.element("svg"),
    ),
  ).toBe(true);
  await page.mouse.down();
  await page.evaluate(() => window.boundsvgLive.update(null, { flush: true }));
  expect(
    await page.evaluate(
      () =>
        (window as Window & { initialRoot: Element | null }).initialRoot ===
        window.boundsvgLive.element("svg"),
    ),
  ).toBe(true);
  await page.evaluate(
    (input) => window.boundsvgLive.update(input, { flush: true }),
    painted("green"),
  );
  await flush(page);
  expect(
    await page.evaluate(() =>
      window.boundsvgLive.read().deliveries.filter((delivery) => delivery.handlerName === "cancel"),
    ),
  ).toHaveLength(0);
  await page.mouse.up();
  await page.mouse.down();
  await page.evaluate(
    (input) => window.boundsvgLive.update(input, { flush: true }),
    painted("green", true),
  );
  await flush(page);
  expect(
    await page.evaluate(() =>
      window.boundsvgLive.read().deliveries.filter((delivery) => delivery.handlerName === "cancel"),
    ),
  ).toHaveLength(1);
  await page.mouse.up();
  await page.evaluate(() => window.boundsvgLive.update(null, { replaceNode: true, flush: true }));
  await flush(page);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { initialRoot: Element | null }).initialRoot ===
        window.boundsvgLive.element("svg"),
    ),
  ).toBe(false);
  await testInfo.attach("React-commit-trace", {
    body: JSON.stringify(await page.evaluate(() => window.boundsvgLive.read())),
    contentType: "application/json",
  });
});

for (const doesLatestMatch of [false, true]) {
  test(`vanilla reentrant cancel compares the actual old/latest Engine snapshots (match=${doesLatestMatch})`, async ({
    page,
  }, testInfo) => {
    await mount(page, frames("A", 2), { adapter: "vanilla" });
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.evaluate(
      ({ middle, latest }) => {
        window.boundsvgLive.clear();
        window.boundsvgLive.setDeliveryHook((delivery) => {
          if (delivery.handlerName === "cancel") {
            window.boundsvgLive.update(latest);
          }
        });
        window.boundsvgLive.update(middle);
      },
      {
        middle: frames("replacement"),
        latest: doesLatestMatch ? frames("A", 2) : frames("replacement"),
      },
    );
    const snapshot = await page.evaluate(() => window.boundsvgLive.read());
    expect(
      snapshot.deliveries.filter((delivery) => delivery.handlerName === "cancel"),
    ).toHaveLength(1);
    const boundaries = snapshot.deliveries.filter(
      (delivery) => delivery.handlerName === "enter" || delivery.handlerName === "leave",
    );
    if (doesLatestMatch) {
      expect(boundaries).toHaveLength(0);
    } else {
      expect(boundaries.map((delivery) => `${delivery.nodeId}:${delivery.handlerName}`)).toEqual([
        "A:leave",
        "replacement:enter",
      ]);
    }
    await page.mouse.up();
    await testInfo.attach("actual-old-latest-trace", {
      body: JSON.stringify(snapshot),
      contentType: "application/json",
    });
  });
}
