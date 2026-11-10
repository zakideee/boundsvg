import { createElement, type VNode } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-live-interaction-harness.js";

test.use({ hasTouch: true });

declare global {
  /** Native RAF observation installed only in this test page. */
  // biome-ignore lint/style/useConsistentTypeDefinitions: Window augmentation requires an interface.
  interface Window {
    touchRafMeter: {
      read: () => { active: number; peak: number };
      settle: () => Promise<void>;
    };
  }
}

/** Same blank Frame and fixed tap point as the compatibility-input counterexample. */
function tapScene(): VNode {
  return createElement(
    "Canvas",
    { width: 360, height: 180 },
    createElement("Box", {
      id: "A",
      width: 100,
      height: 100,
      position: "absolute",
      left: 20,
      top: 20,
      onPointerEnter: "enter",
      onPointerLeave: "leave",
      onPointerDown: "down",
      onPointerUp: "up",
      onTouchEnd: "touchEnd",
      onMouseDown: "mouseDown",
      onMouseUp: "mouseUp",
      onClick: "click",
    }),
  );
}

/** Count native RAF reservations without replacing time or callback delivery. */
async function installRafMeter(page: Page): Promise<void> {
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
      touchRafMeter: {
        read: () => ({ active: active.size, peak }),
        settle: () => new Promise<void>((done) => request(() => request(() => done()))),
      },
    });
  });
}

/** Two actual frames settle adapter commits; they do not synthesize pointer movement. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => window.touchRafMeter.settle());
}

for (const adapter of ["react", "vanilla"] as const) {
  for (const commitIn of ["none", "up", "mouseDown"] as const) {
    test(`${adapter} trusted touch keeps hover cleared and real compatibility callbacks (commit=${commitIn})`, async ({
      page,
    }, testInfo) => {
      await installRafMeter(page);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto("/e2e-live-interaction.html");
      await page.waitForFunction(() => !!window.boundsvgLive);
      // Keep an unrelated native mouse outside the future attachment during touch-only input.
      await page.mouse.move(600, 400);
      await page.evaluate(
        ({ vnode, adapter }) =>
          window.boundsvgLive.mount(vnode, { adapter, scope: "document", animated: true }),
        { vnode: tapScene(), adapter },
      );
      await page.waitForFunction(
        () => window.boundsvgLive.read().ready || !!window.boundsvgLive.read().error,
      );
      await settle(page);
      expect(await page.evaluate(() => window.boundsvgLive.read().error)).toBeNull();
      await page.evaluate((phase) => {
        let committed = false;
        window.boundsvgLive.setDeliveryHook((delivery) => {
          if (!committed && delivery.handlerName === phase) {
            committed = true;
            window.boundsvgLive.update(null, { flush: true });
          }
        });
      }, commitIn);
      await page.touchscreen.tap(50, 50);
      await page.evaluate(() => window.boundsvgLive.setDeliveryHook(null));
      await settle(page);
      const afterTap = await page.evaluate(() => ({
        observed: window.boundsvgLive.read(50, 50),
        raf: window.touchRafMeter.read(),
      }));
      await testInfo.attach("trusted-touch-authority", {
        body: JSON.stringify({ adapter, commitIn, afterTap, pageErrors }),
        contentType: "application/json",
      });
      const deliveries = afterTap.observed.deliveries;
      expect(pageErrors).toEqual([]);
      expect(afterTap.observed.ready).toBe(true);
      for (const handlerName of ["enter", "leave", "mouseDown", "mouseUp", "click"]) {
        expect(deliveries.filter((delivery) => delivery.handlerName === handlerName)).toHaveLength(
          1,
        );
      }
      for (const handlerName of ["mouseDown", "mouseUp", "click"]) {
        expect(deliveries.find((delivery) => delivery.handlerName === handlerName)).toMatchObject({
          cause: "input",
          point: { svgX: 50, svgY: 50 },
          isNativeEventTrusted: true,
        });
      }
      expect(
        deliveries.find((delivery) => delivery.handlerName === "mouseDown")?.nativeConstructor,
      ).toBe("MouseEvent");
      expect(
        deliveries.find((delivery) => delivery.handlerName === "mouseUp")?.nativeConstructor,
      ).toBe("MouseEvent");
      expect(deliveries.find((delivery) => delivery.handlerName === "touchEnd")).toMatchObject({
        generation: 0,
        nativeType: "pointerup",
      });
      expect(deliveries.find((delivery) => delivery.handlerName === "click")?.generation).toBe(
        commitIn === "none" ? 0 : 1,
      );
      expect(afterTap.observed.hoverChanges).toEqual(["A", null]);
      expect(afterTap.observed.hover).toBeNull();
      expect(afterTap.raf.active).toBe(0);

      await page.mouse.move(70, 70);
      await settle(page);
      await page.mouse.down();
      await page.mouse.up();
      const resumed = await page.evaluate(() => ({
        observed: window.boundsvgLive.read(70, 70),
        raf: window.touchRafMeter.read(),
      }));
      await testInfo.attach("mouse-lifecycle-resumption", {
        body: JSON.stringify(resumed),
        contentType: "application/json",
      });
      expect(resumed.observed.hover).toBe("A");
      expect(resumed.raf.active).toBe(1);
      expect(resumed.raf.peak).toBeLessThanOrEqual(1);
      expect(
        resumed.observed.deliveries.filter((delivery) => delivery.handlerName === "click"),
      ).toHaveLength(2);
    });
  }

  test(`${adapter} fresh MouseEvent-only input retains its hover authority`, async ({
    page,
  }, testInfo) => {
    await installRafMeter(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/e2e-live-interaction.html");
    await page.waitForFunction(() => !!window.boundsvgLive);
    // Establish no pointer lifecycle inside this fresh attachment.
    await page.mouse.move(600, 400);
    await page.evaluate(
      ({ vnode, adapter }) =>
        window.boundsvgLive.mount(vnode, { adapter, scope: "document", animated: true }),
      { vnode: tapScene(), adapter },
    );
    await page.waitForFunction(
      () => window.boundsvgLive.read().ready || !!window.boundsvgLive.read().error,
    );
    await page.evaluate(() => {
      for (const type of ["mousedown", "mouseup", "click"]) {
        window.boundsvgLive
          .element("svg")
          ?.dispatchEvent(
            new MouseEvent(type, { bubbles: true, composed: true, clientX: 50, clientY: 50 }),
          );
      }
    });
    const observed = await page.evaluate(() => window.boundsvgLive.read(50, 50));
    await testInfo.attach("fresh-mouse-only", {
      body: JSON.stringify({ observed, pageErrors }),
      contentType: "application/json",
    });
    expect(observed.hover).toBe("A");
    expect(pageErrors).toEqual([]);
    for (const handlerName of ["mouseDown", "mouseUp", "click"]) {
      expect(
        observed.deliveries.filter((delivery) => delivery.handlerName === handlerName),
      ).toHaveLength(1);
    }
  });
}
