import { expect, type Page, test } from "@playwright/test";

const REPRESENTATIVE_ROUTES = ["templates", "playground", "worker"] as const;
const MOBILE_ROUTES = [
  "templates",
  "playground",
  "shapes",
  "text-effects",
  "transform",
  "animation",
  "text-flow",
  "compare",
  "editor",
  "layered",
  "api",
  "worker",
  "interactive",
  "hit-test",
] as const;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

async function openRoute(page: Page, route: string): Promise<void> {
  await page.goto(`/#/${route}`);
  await expect(page.getByText("Engine ready")).toBeVisible({ timeout: 30_000 });
  await expect(renderedSvg(page)).toBeVisible({
    timeout: 30_000,
  });
}

function renderedSvg(page: Page) {
  return page
    .locator(
      "main .rendered-content svg:visible, main .layered-3d-canvas svg:visible, main .visual-editor-render svg:visible, main svg:has([data-boundsvg-text]):visible",
    )
    .first();
}

test.describe("public playground smoke", () => {
  for (const route of REPRESENTATIVE_ROUTES) {
    test(`#/${route} renders without browser errors`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await openRoute(page, route);
      expect(errors).toEqual([]);
    });
  }

  test("a shape control change reaches the renderer", async ({ page }) => {
    await openRoute(page, "shapes");
    const svg = renderedSvg(page);
    const before = await svg.innerHTML();

    await page.locator("main select").first().selectOption({ index: 1 });

    await expect
      .poll(async () => (await svg.innerHTML()) !== before, { timeout: 15_000 })
      .toBe(true);
  });

  test("the template debug control changes public SVG output", async ({ page }) => {
    await openRoute(page, "templates");
    const overlay = page.locator("main svg g.debug-overlay");
    await expect(overlay).toHaveCount(0);

    await page.locator("summary", { hasText: "BBox Overlay" }).first().click();
    await page.locator('label:has-text("node bounds")').first().click();

    await expect(overlay.first()).toBeVisible({ timeout: 15_000 });
  });

  test("the desktop Worker sample retains SVG and PNG outputs", async ({ page }) => {
    await openRoute(page, "worker");
    await expect(page.getByText("SVG Output", { exact: true })).toBeVisible();
    await expect(page.getByText("PNG Output", { exact: true })).toBeVisible();
    await expect(page.getByAltText("Worker PNG output")).toBeVisible({ timeout: 30_000 });
  });

  test("Text Flow rendered code follows preset changes", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/#/text-flow");
    await expect(page.locator(".text-flow-canvas svg").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Rendered SVG", exact: true }).click();
    const renderedSvgCode = page.locator(".preview-body .code-block");
    const presetButton = (label: string) =>
      page.locator('button[data-playground-locator-level="sample"]', { hasText: label });

    await expect(renderedSvgCode).toContainText("flow-obstacle-left-rect");
    await presetButton("Flow Rich, Vertical & Ruby").click();
    await expect(renderedSvgCode).toContainText("flow-obstacle-rich-circle");
    await presetButton("Vertical Rich Ellipsis").click();
    await expect(renderedSvgCode).toContainText("vertical-rich-ellipsis-text");
    expect(errors).toEqual([]);
  });

  test("Transform presets expose every authored origin anchor", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openRoute(page, "transform");
    const presetSelect = page.locator("#transform-preset");
    const originMarkers = page.locator('main svg circle[fill="#f59e0b"][r="2.5"]');
    const expectedOrigins = [
      ["translate-only", 1],
      ["rotate-with-origin", 1],
      ["scale-negative", 1],
      ["nested-transform", 2],
      ["all-node-types", 7],
    ] as const;

    for (const [preset, originCount] of expectedOrigins) {
      await presetSelect.selectOption(preset);
      await expect(originMarkers).toHaveCount(originCount);
    }
    expect(errors).toEqual([]);
  });
});

test.describe("mobile sample viewer", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  test("every route keeps document scrolling and an unclipped primary preview", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);

    for (const route of MOBILE_ROUTES) {
      await test.step(route, async () => {
        await page.goto(`/#/${route}`);
        await expect(page.locator(`.example-shell[data-route="${route}"]`)).toBeVisible();
        await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
        await expect(page.locator(".preview-header > .preview-view-tabs").first()).toBeHidden();

        const metrics = await page.evaluate(() => {
          const isVisible = (element: Element): boolean => {
            const elementRect = element.getBoundingClientRect();
            const elementStyle = getComputedStyle(element);
            return (
              elementStyle.display !== "none" &&
              elementStyle.visibility !== "hidden" &&
              elementRect.width > 0 &&
              elementRect.height > 0
            );
          };
          const firstPreview = [
            ...document.querySelectorAll(".preview-panel, .visual-editor-canvas-panel"),
          ].find(isVisible);
          const firstControls = [...document.querySelectorAll(".controls-panel")].find(isVisible);
          const clippedPanels = [...document.querySelectorAll<HTMLElement>(".panel")].filter(
            (panel) =>
              isVisible(panel) &&
              panel.clientHeight > 0 &&
              panel.scrollHeight > panel.clientHeight + 2 &&
              getComputedStyle(panel).overflowY !== "visible",
          );
          const scrollingElement = document.scrollingElement;
          const main = document.querySelector(".example-main");
          const shell = document.querySelector(".example-shell");
          if (!scrollingElement || !main || !shell) {
            throw new Error("Missing playground shell elements");
          }
          return {
            clippedPanelCount: clippedPanels.length,
            documentClientWidth: scrollingElement.clientWidth,
            documentScrollWidth: scrollingElement.scrollWidth,
            mainOverflowY: getComputedStyle(main).overflowY,
            previewBeforeControls:
              !firstPreview ||
              !firstControls ||
              firstPreview.getBoundingClientRect().top < firstControls.getBoundingClientRect().top,
            shellOverflowY: getComputedStyle(shell).overflowY,
          };
        });

        expect(metrics.documentScrollWidth, `${route}: document overflow`).toBe(
          metrics.documentClientWidth,
        );
        expect(metrics.shellOverflowY, `${route}: shell scroll ownership`).toBe("visible");
        expect(metrics.mainOverflowY, `${route}: main scroll ownership`).toBe("visible");
        expect(metrics.clippedPanelCount, `${route}: clipped panels`).toBe(0);
        expect(metrics.previewBeforeControls, `${route}: preview ordering`).toBe(true);
      });
    }

    expect(errors).toEqual([]);
  });

  test("Layout Compare keeps both renderers at one scale and one font", async ({ page }) => {
    await page.goto("/#/compare");
    const sampleSelect = page.locator(".mobile-sample-select select");
    const svgSurface = page.locator(".compare-pane .rendered-content > div > svg:first-child");
    const htmlSurface = page.locator(".compare-html-surface");
    await expect(svgSurface).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);

    for (const sampleId of ["flex-row-basic", "holy-grail"]) {
      await sampleSelect.selectOption(sampleId);
      await expect
        .poll(async () => {
          const svgBox = await svgSurface.boundingBox();
          const htmlBox = await htmlSurface.boundingBox();
          if (!svgBox || !htmlBox) {
            return null;
          }
          return {
            widthDifference: Math.abs(svgBox.width - htmlBox.width),
            heightDifference: Math.abs(svgBox.height - htmlBox.height),
          };
        })
        .toEqual({ widthDifference: 0, heightDifference: 0 });
    }

    const fontMetrics = await page.evaluate(() => {
      const htmlTextElement = [
        ...document.querySelectorAll<HTMLElement>(".compare-html-surface *"),
      ].find((element) => getComputedStyle(element).fontFamily.includes("BoundSvg Editor Sans"));
      if (!htmlTextElement) {
        throw new Error("Missing Layout Compare HTML text");
      }
      return {
        fontFamily: getComputedStyle(htmlTextElement).fontFamily,
        fontReady: document.fonts.check('14px "BoundSvg Editor Sans"'),
      };
    });
    expect(fontMetrics.fontFamily).toContain("BoundSvg Editor Sans");
    expect(fontMetrics.fontReady).toBe(true);
  });

  test("entering the phone viewer preserves sample state and returns to Preview", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto("/#/templates");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });

    await page.locator(".template-button", { hasText: "Measurements" }).click();
    await expect(page.locator(".preview-header-meta h3")).toHaveText("Measurements");
    await page.getByRole("button", { name: "Generated JSX" }).click();
    await expect(page.locator(".preview-panel")).toHaveClass(/show-code/);

    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.locator(".mobile-sample-select select")).toHaveValue("measurements");
    await expect(page.locator(".preview-header-meta h3")).toHaveText("Measurements");
    await expect(page.locator(".preview-panel")).not.toHaveClass(/show-code/);
    await expect(renderedSvg(page)).toBeVisible();
  });

  test("entering the phone Controls editor preserves document edits and closes source", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto("/#/playground");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });

    const textInput = page.locator("#editor-text-content");
    await textInput.fill("Persistent mobile edit");
    await page.getByRole("button", { name: "Show source" }).click();
    await expect(page.locator(".visual-editor-output")).toHaveClass(/is-open/);

    await page.setViewportSize({ width: 390, height: 844 });

    await expect(textInput).toHaveValue("Persistent mobile edit");
    await expect(page.locator(".visual-editor-output")).not.toHaveClass(/is-open/);
    await expect(renderedSvg(page)).toBeVisible();
  });

  test("the touch-focused interaction scene logs a tap sequence", async ({ page }) => {
    await page.goto("/#/interactive");
    const touchCard = page.locator('[data-boundsvg-node-id="card-touch"]').first();
    await expect(touchCard).toBeVisible({ timeout: 30_000 });

    await touchCard.tap();

    const eventLog = page.locator(".controls-panel");
    await expect(eventLog).toContainText("touchStart");
    await expect(eventLog).toContainText("touchEnd");
  });

  test("Controls Editor keeps selection handles usable at phone fit zoom", async ({ page }) => {
    await page.goto("/#/playground");
    const artboard = page.locator(".visual-editor-artboard-content");
    const selection = page.locator(".visual-editor-selection");
    const leftEdge = selection.locator(".edge-left");
    const rightEdge = selection.locator(".edge-right");
    const eastHandle = page.locator('[data-editor-transform-handle="e"]');
    const rotateHandle = page.locator('[data-editor-transform-handle="rotate"]');
    await expect(selection).toBeVisible({ timeout: 30_000 });

    const metrics = await page.evaluate(() => {
      const artboardElement = document.querySelector<HTMLElement>(
        ".visual-editor-artboard-content",
      );
      if (!artboardElement) {
        throw new Error("Missing Controls Editor artboard");
      }
      return {
        pointerEvents: getComputedStyle(artboardElement).pointerEvents,
      };
    });
    expect(metrics.pointerEvents).toBe("auto");

    const handleBox = await eastHandle.boundingBox();
    const beforeSelectionBox = await selection.boundingBox();
    const leftEdgeBox = await leftEdge.boundingBox();
    const rightEdgeBox = await rightEdge.boundingBox();
    if (!handleBox || !beforeSelectionBox || !leftEdgeBox || !rightEdgeBox) {
      throw new Error("Missing Controls Editor selection handle bounds");
    }
    expect(leftEdgeBox.width).toBeGreaterThanOrEqual(1.5);
    expect(rightEdgeBox.width).toBeGreaterThanOrEqual(1.5);
    expect(leftEdgeBox.height).toBeGreaterThanOrEqual(beforeSelectionBox.height - 1);
    expect(rightEdgeBox.height).toBeGreaterThanOrEqual(beforeSelectionBox.height - 1);
    expect(handleBox.width).toBeGreaterThanOrEqual(43);
    expect(handleBox.height).toBeGreaterThanOrEqual(43);

    const cdpSession = await page.context().newCDPSession(page);
    const initialRotateHandleBox = await rotateHandle.boundingBox();
    if (!initialRotateHandleBox) {
      throw new Error("Missing Controls Editor rotate handle bounds");
    }
    const tapStartX = initialRotateHandleBox.x + 4;
    const tapStartY = initialRotateHandleBox.y + initialRotateHandleBox.height / 2;
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: tapStartX, y: tapStartY, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: tapStartX + 2, y: tapStartY, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(selection).toHaveAttribute("style", /rotate\(0deg\)/);

    const dragStartX = handleBox.x + handleBox.width / 2;
    const dragStartY = handleBox.y + handleBox.height / 2;
    const beforeScrollY = await page.evaluate(() => window.scrollY);
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: dragStartX, y: dragStartY, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: dragStartX + 24, y: dragStartY, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect
      .poll(async () => (await selection.boundingBox())?.width ?? 0)
      .toBeGreaterThan(beforeSelectionBox.width + 16);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScrollY);
    const dragSurface = page.locator(".visual-editor-selection-drag-surface");
    await expect(dragSurface).toBeVisible();
    const dragSurfaceBox = await dragSurface.boundingBox();
    const beforeMoveBox = await selection.boundingBox();
    if (!dragSurfaceBox || !beforeMoveBox) {
      throw new Error("Missing Controls Editor move surface bounds");
    }
    const moveStartX = dragSurfaceBox.x + Math.min(70, dragSurfaceBox.width / 2);
    const moveStartY = dragSurfaceBox.y + Math.min(70, dragSurfaceBox.height / 2);
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: moveStartX, y: moveStartY, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: moveStartX, y: moveStartY + 18, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await selection.boundingBox())?.y ?? 0)
      .toBeGreaterThan(beforeMoveBox.y + 12);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScrollY);

    const rotateTo = async (endPosition: "right" | "bottom") => {
      const rotateHandleBox = await rotateHandle.boundingBox();
      const currentSelectionBox = await selection.boundingBox();
      if (!rotateHandleBox || !currentSelectionBox) {
        throw new Error("Missing Controls Editor rotate handle bounds");
      }
      const centerX = currentSelectionBox.x + currentSelectionBox.width / 2;
      const centerY = currentSelectionBox.y + currentSelectionBox.height / 2;
      const startX = rotateHandleBox.x + rotateHandleBox.width / 2;
      const startY = rotateHandleBox.y + rotateHandleBox.height / 2;
      await cdpSession.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: startX, y: startY, radiusX: 3, radiusY: 3 }],
      });
      await cdpSession.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: endPosition === "right" ? centerX + 60 : centerX,
            y: endPosition === "bottom" ? centerY + 60 : centerY,
            radiusX: 3,
            radiusY: 3,
          },
        ],
      });
      await cdpSession.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };

    await rotateTo("right");
    await expect(selection).toHaveAttribute("style", /rotate\(90deg\)/);
    await rotateTo("bottom");
    await expect(selection).toHaveAttribute("style", /rotate\(180deg\)/);
    await expect(artboard).toHaveCSS("touch-action", "pan-y pinch-zoom");
  });

  test("dragging a Text Flow obstacle does not scroll the document", async ({ page }) => {
    await page.goto("/#/text-flow");
    const obstacle = page.locator('[data-boundsvg-node-id="flow-obstacle-left-rect"]').first();
    await expect(obstacle).toBeVisible({ timeout: 30_000 });
    await obstacle.scrollIntoViewIfNeeded();

    const beforeBox = await obstacle.boundingBox();
    if (!beforeBox) {
      throw new Error("Missing Text Flow obstacle bounds");
    }
    const beforeScrollY = await page.evaluate(() => window.scrollY);
    const dragStartX = beforeBox.x + beforeBox.width / 2;
    const dragStartY = beforeBox.y + beforeBox.height / 2;
    const cdpSession = await page.context().newCDPSession(page);

    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: dragStartX, y: dragStartY, radiusX: 2, radiusY: 2 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: dragStartX + 18, y: dragStartY + 28, radiusX: 2, radiusY: 2 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    const afterBox = await obstacle.boundingBox();
    const afterScrollY = await page.evaluate(() => window.scrollY);
    expect(afterBox?.x).toBeGreaterThan(beforeBox.x + 8);
    expect(Math.abs(afterScrollY - beforeScrollY)).toBeLessThan(2);
  });

  test("Text Flow samples reset their state when switching presets", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/#/text-flow");
    const flowSvg = page.locator(".text-flow-canvas svg").first();
    const presetSelect = page.locator(".mobile-sample-select select");
    const sceneNode = (nodeId: string) =>
      page.locator(`[data-boundsvg-node-id="${nodeId}"]`).first();
    await expect(flowSvg).toBeVisible({ timeout: 30_000 });
    await expect(flowSvg).toHaveAttribute("width", "800");
    await expect(flowSvg).toHaveAttribute("height", "720");
    await expect(sceneNode("flow-obstacle-left-rect")).toBeVisible();

    await presetSelect.selectOption("flow-rich");
    await expect(flowSvg).toHaveAttribute("width", "560");
    await expect(flowSvg).toHaveAttribute("height", "560");
    await expect(sceneNode("flow-obstacle-rich-circle")).toBeVisible();
    await expect(sceneNode("flow-obstacle-vertical-rect")).toBeVisible();
    await expect(sceneNode("flow-obstacle-ruby-rect")).toBeVisible();

    await presetSelect.selectOption("vertical-rich-ellipsis");
    await expect(flowSvg).toHaveAttribute("width", "640");
    await expect(flowSvg).toHaveAttribute("height", "360");
    await expect(sceneNode("vertical-rich-ellipsis-text")).toBeVisible();
    await expect(page.locator(".text-flow-reset-btn")).toHaveCount(0);

    await presetSelect.selectOption("text-flow");
    await expect(flowSvg).toHaveAttribute("width", "800");
    await expect(flowSvg).toHaveAttribute("height", "720");
    await expect(sceneNode("flow-obstacle-left-rect")).toBeVisible();
    await expect(sceneNode("flow-obstacle-right-rect")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Multi-SVG Editor keeps PNG export compact without hiding its settings", async ({
    page,
  }) => {
    await page.goto("/#/editor");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });

    const compositionHeader = page.locator(".editor-composition-header");
    const exportButton = page.getByRole("button", { name: "PNG · 2×" });
    await expect(exportButton).toBeVisible();
    expect((await compositionHeader.boundingBox())?.height).toBeLessThanOrEqual(60);
    await expect(page.locator("#editor-export-scale")).toHaveCount(0);

    await page.locator(".controls-panel .section-header", { hasText: "Export" }).click();
    await expect(page.locator("#editor-export-scale")).toBeVisible();
  });

  test("Multi-SVG Editor moves the selected asset with a touch drag", async ({ page }) => {
    await page.goto("/#/editor");
    const selection = page.locator(".editor-selection-overlay");
    const dragSurface = selection.locator(".editor-selection-drag");
    await expect(selection).toBeVisible({ timeout: 30_000 });

    const beforeBox = await selection.boundingBox();
    const dragSurfaceBox = await dragSurface.boundingBox();
    if (!beforeBox || !dragSurfaceBox) {
      throw new Error("Missing Multi-SVG Editor drag surface bounds");
    }

    const beforeScrollY = await page.evaluate(() => window.scrollY);
    const dragStartX = dragSurfaceBox.x + dragSurfaceBox.width / 2;
    const dragStartY = dragSurfaceBox.y + dragSurfaceBox.height / 2;
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: dragStartX, y: dragStartY, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: dragStartX + 24, y: dragStartY + 18, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect
      .poll(async () => {
        const afterBox = await selection.boundingBox();
        return afterBox !== null && afterBox.x - beforeBox.x > 20 && afterBox.y - beforeBox.y > 12;
      })
      .toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScrollY);
    await expect(dragSurface).toHaveCSS("touch-action", "none");

    const badge = page.locator('.editor-canvas-content svg[data-boundsvg-node-id="badge"]');
    const badgeBeforeBox = await badge.boundingBox();
    if (!badgeBeforeBox) {
      throw new Error("Missing Multi-SVG Editor badge bounds");
    }
    const badgeStartX = badgeBeforeBox.x + badgeBeforeBox.width / 2;
    const badgeStartY = badgeBeforeBox.y + badgeBeforeBox.height / 2;
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: badgeStartX, y: badgeStartY, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: badgeStartX - 24, y: badgeStartY + 18, radiusX: 3, radiusY: 3 }],
    });
    await cdpSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect(page.locator(".editor-composition-info")).toContainText("Selected: badge");
    await expect
      .poll(async () => {
        const badgeAfterBox = await badge.boundingBox();
        return (
          badgeAfterBox !== null &&
          badgeBeforeBox.x - badgeAfterBox.x > 20 &&
          badgeAfterBox.y - badgeBeforeBox.y > 12
        );
      })
      .toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScrollY);
  });

  test("Worker and Layered keep only SVG rendering in the phone viewer", async ({ page }) => {
    await page.goto("/#/worker");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".worker-preview-header")).toBeHidden();
    await expect(page.locator(".worker-mobile-status")).toContainText("Worker active");
    await expect(page.getByText("SVG Output", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Rendered via Worker/)).toHaveCount(0);
    await expect(page.getByText("Provider Status", { exact: true })).toHaveCount(0);
    await expect(page.getByText("PNG Output", { exact: true })).toHaveCount(0);
    await expect(page.getByText("PNG (async)", { exact: true })).toHaveCount(0);
    const workerStageBox = await page.locator(".preview-stage").first().boundingBox();
    const workerSvgBox = await renderedSvg(page).boundingBox();
    expect((workerStageBox?.height ?? 0) - (workerSvgBox?.height ?? 0)).toBeLessThanOrEqual(14);

    await page.goto("/#/layered");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Layered SVG", { exact: true })).toBeVisible();
    await expect(page.locator(".mobile-sample-select")).toBeVisible();
    await expect(page.getByText("Single SVG", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Toggles", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Status", { exact: true })).toHaveCount(0);
    await expect(page.locator(".layered-format-toggle")).toHaveCount(0);
    await expect(page.getByAltText(/PNG output/)).toHaveCount(0);
  });

  test("compact navigation and template controls hide secondary APIs", async ({ page }) => {
    await page.goto("/#/templates");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });

    const activeCategory = page.locator(".route-nav-categories .route-link.active");
    const categoryBox = await activeCategory.boundingBox();
    expect(categoryBox?.height).toBeLessThanOrEqual(32);
    const sampleLabelBox = await page.locator(".mobile-sample-select > span").boundingBox();
    const sampleSelectBox = await page.locator(".mobile-sample-select > select").boundingBox();
    expect(sampleLabelBox?.y).toBeDefined();
    expect(sampleSelectBox?.y).toBeDefined();
    expect(Math.abs((sampleLabelBox?.y ?? 0) - (sampleSelectBox?.y ?? 0))).toBeLessThan(12);
    await expect(page.locator(".mobile-sample-select > select")).toHaveCSS("color-scheme", "dark");
    await expect(page.locator("#tpl-renderer")).toBeHidden();
    await expect(page.locator("#tpl-text-rendering")).toBeHidden();
    await expect(page.getByText("Render", { exact: true })).toBeHidden();

    await page.goto("/#/shapes");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    const widthLabelBox = await page.locator('label[for="shape-w"]').boundingBox();
    const widthInputBox = await page.locator("#shape-w").boundingBox();
    expect(widthLabelBox?.x).toBeLessThan(widthInputBox?.x ?? 0);
    expect(Math.abs((widthLabelBox?.y ?? 0) - (widthInputBox?.y ?? 0))).toBeLessThan(12);
    await expect(page.locator("#shape-renderer")).toBeHidden();

    await page.goto("/#/text-flow");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".mobile-sample-select")).toBeVisible();
    await expect(page.locator("#flow-debug")).toBeHidden();

    await page.goto("/#/transform");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#transform-renderer")).toBeHidden();
    await expect(page.locator(".preview-subtitle")).toBeHidden();

    await page.goto("/#/compare");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#compare-debug")).toBeHidden();

    await page.goto("/#/api");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#api-view")).toBeHidden();

    await page.goto("/#/animation");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".mobile-viewer-note")).toHaveCount(0);
    await expect(page.locator("#animation-time")).toBeHidden();
    await expect(page.getByTestId("animation-download-still")).toHaveCount(0);
    await expect(page.getByTestId("animation-export-actions")).toHaveCount(0);

    await page.goto("/#/worker");
    await expect(renderedSvg(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.route-nav-pages a[href="#/api"]')).toHaveCount(0);
  });
});
