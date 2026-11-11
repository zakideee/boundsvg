import { createElement, type GeometryDoc, type VNode } from "@boundsvg/core";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-live-interaction-harness.js";

/** Authored references are shared by paint and no-paint producers. */
const REFERENCES = {
  onClick: "select",
  onPointerEnter: "enter",
  onPointerOver: "over",
  onPointerLeave: "leave",
  onPointerOut: "out",
  onPointerDown: "down",
  onPointerUp: "up",
  onPointerCancel: "cancel",
  onPointerMove: "move",
};
/** Two filled source parts exercise the real Shape emitter. */
const GEOMETRY: GeometryDoc = {
  viewBox: { width: 100, height: 60 },
  root: {
    kind: "group",
    children: [
      { kind: "path", d: "M0 0H50V60H0Z" },
      { kind: "path", d: "M50 0H100V60H50Z" },
    ],
  },
};

/** These author inputs keep fixed test points away from layout boundaries. */
function canvas(...children: VNode[]): VNode {
  return createElement("Canvas", { width: 360, height: 180 }, ...children);
}
/** The pinned font's H crossbar contains fixed point (130,60) with a 2px margin. */
function label(options: Record<string, unknown> = {}, kind: "Text" | "TextOnPath" = "Text"): VNode {
  return createElement(
    kind,
    {
      id: "label",
      position: "absolute",
      left: 100,
      top: kind === "TextOnPath" ? 10 : 22,
      width: 100,
      height: 100,
      font: "Test",
      fontSizePx: 64,
      color: "black",
      ...(kind === "TextOnPath" ? { d: "M0 75H100" } : {}),
      ...options,
    },
    "H",
  );
}
/** Empty sibling Frame and native Text overflow the same small outer handler. */
function witnessScene(hasFrontFrame: boolean, options: Record<string, unknown> = {}): VNode {
  return canvas(
    createElement(
      "Box",
      {
        id: "outer",
        position: "absolute",
        width: 40,
        height: 40,
        onClick: "outerClick",
        ...options,
      },
      label(),
      ...(hasFrontFrame
        ? [
            createElement("Box", {
              id: "front",
              position: "absolute",
              left: 100,
              top: 10,
              width: 100,
              height: 100,
              onClick: "frontClick",
            }),
          ]
        : []),
    ),
  );
}
/** Production commits and native animation sampling settle before assertions. */
async function flush(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
/** Each case uses real Engine output, an actual adapter and an owned DOM scope. */
async function mount(
  page: Page,
  input: VNode,
  options: Partial<Parameters<Window["boundsvgLive"]["mount"]>[1]> = {},
): Promise<void> {
  await page.goto("/e2e-live-interaction.html");
  await page.waitForFunction(() => !!window.boundsvgLive);
  await page.evaluate(({ vnode, settings }) => window.boundsvgLive.mount(vnode, settings), {
    vnode: input,
    settings: { adapter: "vanilla", scope: "document", animated: false, ...options },
  });
  if (!options.delayed) {
    await page.waitForFunction(
      () => window.boundsvgLive.read().ready || !!window.boundsvgLive.read().error,
    );
    expect(await page.evaluate(() => window.boundsvgLive.read().error)).toBeNull();
  }
  await flush(page);
}

for (const adapter of ["react", "vanilla"] as const) {
  for (const hasFrontFrame of [false, true]) {
    test(`${adapter} native Text witness respects the selected branch (front=${hasFrontFrame})`, async ({
      page,
    }, testInfo) => {
      await mount(page, witnessScene(hasFrontFrame), { adapter });
      const before = await page.evaluate(() => window.boundsvgLive.read(130, 60));
      expect(before.nativeSource).toBe("label");
      expect(before.query).toMatchObject({
        status: "ready",
        hit: { nodeId: hasFrontFrame ? "front" : "label" },
      });
      await page.mouse.click(130, 60, { button: "right" });
      const after = await page.evaluate(() => window.boundsvgLive.read(130, 60));
      expect(after.menus).toHaveLength(hasFrontFrame ? 0 : 1);
      if (!hasFrontFrame) {
        expect(after.menus[0]).toMatchObject({
          nodeId: "label",
          nodeText: "H",
          lineText: "H",
          point: { svgX: 130, svgY: 60 },
        });
      }
      await testInfo.attach("text-witness", {
        body: JSON.stringify({ before, after }),
        contentType: "application/json",
      });
    });
  }

  test(`${adapter} ancestor Frame retains its native Text witness and static-label line copy`, async ({
    page,
  }, testInfo) => {
    const input = (hasContextHandler: boolean) => {
      const witness = witnessScene(false, {
        width: 240,
        height: 140,
        ...(hasContextHandler ? { onContextMenu: "outerMenu" } : {}),
      });
      return createElement(
        "Canvas",
        { width: 360, height: 180 },
        ...witness.children,
        createElement("Box", {
          position: "absolute",
          left: 280,
          top: 120,
          width: 30,
          height: 30,
          background: "blue",
          animate: {
            keyframes: [
              { at: 0, transform: { translateX: 0 } },
              { at: 1, transform: { translateX: 12 } },
            ],
            durationMs: 1000,
            fill: "both",
          },
        }),
      );
    };
    await mount(page, input(false), {
      adapter,
      animated: true,
    });
    expect(
      await page.evaluate(() => window.boundsvgLive.read().animationTimes.length),
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.boundsvgLive.read(130, 60).query)).toMatchObject({
      status: "ready",
      hit: { nodeId: "outer" },
    });
    await page.mouse.click(130, 60, { button: "right" });
    expect(await page.evaluate(() => window.boundsvgLive.read().menus)).toEqual([
      expect.objectContaining({ nodeId: "label", lineText: "H", point: { svgX: 130, svgY: 60 } }),
    ]);
    await page.evaluate(() => {
      Object.assign(window, { beforeTextRoot: window.boundsvgLive.element("svg") });
    });
    await page.evaluate((next) => {
      window.boundsvgLive.clear();
      window.boundsvgLive.update(next, { flush: true });
    }, input(true));
    await flush(page);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { beforeTextRoot: Element | null }).beforeTextRoot ===
          window.boundsvgLive.element("svg"),
      ),
    ).toBe(true);
    await page.mouse.click(130, 60, { button: "right" });
    const explicit = await page.evaluate(() => window.boundsvgLive.read());
    expect(explicit.menus).toHaveLength(0);
    expect(
      explicit.deliveries.filter((delivery) => delivery.handlerName === "outerMenu"),
    ).toHaveLength(1);
    await testInfo.attach("static-label-context-priority", {
      body: JSON.stringify(explicit),
      contentType: "application/json",
    });
  });

  for (const animationOwner of ["unit", "ancestor"] as const) {
    test(`${adapter} animated ${animationOwner} Text has node copy and no sampled line point`, async ({
      page,
    }, testInfo) => {
      const motion = {
        keyframes: [
          { at: 0, transform: { translateX: 0 } },
          { at: 1, transform: { translateX: 80 } },
        ],
        durationMs: 800,
        easing: "linear",
        fill: "both",
      };
      const input =
        animationOwner === "unit"
          ? canvas(label({ animateUnits: { by: "cluster", animation: motion, delayStepMs: 0 } }))
          : canvas(createElement("Box", { width: 240, height: 140, animate: motion }, label()));
      await mount(page, input, { adapter, animated: true });
      expect(await page.evaluate(() => window.boundsvgLive.seek(0))).toBeGreaterThan(0);
      await flush(page);
      const first = await page.evaluate(() => window.boundsvgLive.read(130, 60));
      expect(first.nativeSource).toBe("label");
      await page.mouse.click(130, 60, { button: "right" });
      expect(await page.evaluate(() => window.boundsvgLive.read().menus)).toEqual([
        expect.objectContaining({ nodeId: "label", nodeText: "H", lineText: null, point: null }),
      ]);
      await page.evaluate(() => window.boundsvgLive.seek(800));
      await flush(page);
      const moved = await page.evaluate(() => window.boundsvgLive.read(210, 60));
      expect(moved.query).toMatchObject({ status: "ready", hit: { nodeId: "label" } });
      await testInfo.attach("animated-text", {
        body: JSON.stringify({ first, moved }),
        contentType: "application/json",
      });
    });
  }

  test(`${adapter} real source producers, parts, opaque SVG, TextOnPath and Frame domains`, async ({
    page,
  }, testInfo) => {
    const observations = [];
    const subjects: {
      name: string;
      input: VNode;
      point: [number, number];
      expected: string | null;
    }[] = [
      ...(["Canvas", "Flex", "Grid", "Box"] as const).map((producer) => ({
        name: producer,
        input:
          producer === "Canvas"
            ? createElement("Canvas", { width: 360, height: 180, id: "subject", ...REFERENCES })
            : canvas(
                createElement(producer, {
                  id: "subject",
                  position: "absolute",
                  left: 20,
                  top: 20,
                  width: 100,
                  height: 100,
                  ...REFERENCES,
                }),
              ),
        point: [30, 30] as [number, number],
        expected: "subject",
      })),
      {
        name: "emptyText",
        input: canvas(
          createElement(
            "Text",
            {
              id: "subject",
              position: "absolute",
              left: 20,
              top: 20,
              width: 100,
              height: 100,
              font: "Test",
              fontSizePx: 64,
              ...REFERENCES,
            },
            "",
          ),
        ),
        point: [30, 30],
        expected: null,
      },
      {
        name: "roundedFrameCorner",
        input: canvas(
          createElement("Box", {
            id: "subject",
            position: "absolute",
            left: 20,
            top: 20,
            width: 100,
            height: 100,
            borderRadius: 40,
            ...REFERENCES,
          }),
        ),
        point: [24, 24],
        expected: "subject",
      },
      {
        name: "zeroWidth",
        input: canvas(
          createElement("Box", {
            id: "subject",
            position: "absolute",
            left: 20,
            top: 20,
            width: 0,
            height: 100,
            ...REFERENCES,
          }),
        ),
        point: [20, 30],
        expected: null,
      },
      {
        name: "parts",
        input: canvas(
          createElement("Box", {
            id: "subject",
            position: "absolute",
            left: 20,
            top: 20,
            width: 100,
            height: 100,
            background: "red",
            borderWidth: 4,
            borderColor: "blue",
            ...REFERENCES,
          }),
        ),
        point: [50, 50],
        expected: "subject",
      },
      {
        name: "shape",
        input: canvas(
          createElement("Shape", {
            id: "subject",
            position: "absolute",
            left: 20,
            top: 20,
            width: 100,
            height: 60,
            geometry: GEOMETRY,
            fill: "red",
            ...REFERENCES,
          }),
        ),
        point: [50, 50],
        expected: "subject",
      },
      {
        name: "opaque",
        input: canvas(
          createElement("Svg", {
            id: "subject",
            position: "absolute",
            left: 20,
            top: 20,
            width: 100,
            height: 60,
            content:
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="red" data-boundsvg-node-index="0" data-boundsvg-node-id="foreign"/></svg>',
            ...REFERENCES,
          }),
        ),
        point: [50, 50],
        expected: "subject",
      },
      {
        name: "textOnPath",
        input: canvas(label({}, "TextOnPath")),
        point: [130, 60],
        expected: "label",
      },
    ];
    for (const subject of subjects) {
      await mount(page, subject.input, { adapter });
      const observation = await page.evaluate(
        ([x, y]) => window.boundsvgLive.read(x, y),
        subject.point,
      );
      observations.push({ name: subject.name, observation });
      await testInfo.attach(`producer-${subject.name}`, {
        body: JSON.stringify(observation),
        contentType: "application/json",
      });
      if (subject.name === "emptyText") {
        expect(observation.sources.find((source) => source.nodeId === "subject")).toMatchObject({
          primaryNodeIndex: expect.any(Number),
        });
      }
      expect(observation.query, subject.name).toMatchObject({
        status: "ready",
        hit: subject.expected === null ? null : { nodeId: subject.expected },
      });
    }
    await testInfo.attach("producer-and-domain-coverage", {
      body: JSON.stringify(observations),
      contentType: "application/json",
    });
  });

  test(`${adapter} nested own and ancestor BoxClips use current owner poses`, async ({
    page,
  }, testInfo) => {
    const input = canvas(
      createElement(
        "Box",
        {
          id: "clipOwner",
          position: "absolute",
          left: 20,
          top: 20,
          width: 100,
          height: 100,
          borderRadius: 20,
          overflow: "clip",
        },
        createElement(
          "Box",
          {
            id: "innerClip",
            position: "absolute",
            left: 20,
            top: 20,
            width: 60,
            height: 60,
            borderRadius: 20,
            overflow: "clip",
          },
          createElement("Box", { id: "subject", width: 100, height: 100, ...REFERENCES }),
        ),
      ),
    );
    await mount(page, input, { adapter, animated: true });
    expect(await page.evaluate(() => window.boundsvgLive.read(70, 70).query)).toMatchObject({
      status: "ready",
      hit: { nodeId: "subject" },
    });
    expect(await page.evaluate(() => window.boundsvgLive.read(43, 43).query)).toMatchObject({
      status: "ready",
      hit: null,
    });
    await page.evaluate(() => {
      const owner = window.boundsvgLive.element('[data-boundsvg-node-id="clipOwner"]');
      if (!(owner instanceof SVGElement)) {
        throw new Error("Missing clip source endpoint");
      }
      owner.style.transform = "translateX(80px)";
    });
    await flush(page);
    const oldPoint = await page.evaluate(() => window.boundsvgLive.read(70, 70));
    const newPoint = await page.evaluate(() => window.boundsvgLive.read(150, 70));
    expect(oldPoint.query).toMatchObject({ status: "ready", hit: null });
    expect(newPoint.query).toMatchObject({ status: "ready", hit: { nodeId: "subject" } });
    await testInfo.attach("clip-owner-current-pose", {
      body: JSON.stringify({ oldPoint, newPoint }),
      contentType: "application/json",
    });
  });

  for (const scope of ["document", "open", "closed", "slot", "nested"] as const) {
    test(`${adapter} CSS and WAAPI current Frame pose with foreign-SVG遮蔽 (${scope})`, async ({
      page,
    }, testInfo) => {
      const input = canvas(
        createElement("Box", {
          id: "subject",
          position: "absolute",
          left: 20,
          top: 20,
          width: 100,
          height: 100,
          ...REFERENCES,
        }),
      );
      await mount(page, input, { adapter, scope, animated: true });
      await page.mouse.move(50, 60);
      await flush(page);
      await page.evaluate(() => {
        const endpoint = window.boundsvgLive.element('[data-boundsvg-node-id="subject"]');
        if (!(endpoint instanceof SVGElement)) {
          throw new Error("Missing Frame endpoint");
        }
        endpoint.style.transform = "translateX(100px)";
      });
      await flush(page);
      expect(await page.evaluate(() => window.boundsvgLive.read(50, 60).query)).toMatchObject({
        status: "ready",
        hit: null,
      });
      expect(await page.evaluate(() => window.boundsvgLive.read(150, 60).query)).toMatchObject({
        status: "ready",
        hit: { nodeId: "subject" },
      });
      await page.evaluate(() => {
        const endpoint = window.boundsvgLive.element('[data-boundsvg-node-id="subject"]');
        if (!endpoint) {
          throw new Error("Missing Frame endpoint");
        }
        const animation = endpoint.animate(
          [{ transform: "translateX(0px)" }, { transform: "translateX(100px)" }],
          { duration: 1000, fill: "both" },
        );
        animation.pause();
        animation.currentTime = 0;
      });
      await flush(page);
      expect(await page.evaluate(() => window.boundsvgLive.read(50, 60).query)).toMatchObject({
        status: "ready",
        hit: { nodeId: "subject" },
      });
      await page.evaluate(() => window.boundsvgLive.seek(1000));
      await flush(page);
      const current = await page.evaluate(() => window.boundsvgLive.read(150, 60));
      expect(current.query).toMatchObject({ status: "ready", hit: { nodeId: "subject" } });
      await page.evaluate(() => {
        const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        overlay.setAttribute("width", "360");
        overlay.setAttribute("height", "180");
        overlay.style.cssText = "position:fixed;inset:0;z-index:100";
        overlay.innerHTML = '<rect width="360" height="180" fill="black"/>';
        document.body.append(overlay);
      });
      const blocked = await page.evaluate(() => window.boundsvgLive.read(150, 60));
      expect(blocked.query).toMatchObject({ status: "ready", hit: null });
      await testInfo.attach("current-pose-and-scope", {
        body: JSON.stringify({ current, blocked }),
        contentType: "application/json",
      });
    });
  }

  test(`${adapter} handlerless foreground paint and outermost target obey one IR order`, async ({
    page,
  }) => {
    await mount(
      page,
      canvas(
        createElement("Box", { id: "behind", width: 200, height: 100, ...REFERENCES }),
        createElement("Box", {
          id: "blocker",
          position: "absolute",
          width: 200,
          height: 100,
          background: "black",
        }),
      ),
      { adapter },
    );
    expect(await page.evaluate(() => window.boundsvgLive.read(50, 50).query)).toMatchObject({
      status: "ready",
      hit: { nodeId: "blocker" },
    });
    await page.mouse.click(50, 50);
    expect(await page.evaluate(() => window.boundsvgLive.read().deliveries)).toHaveLength(0);
    await page.evaluate(
      (next) => window.boundsvgLive.update(next, { flush: true }),
      canvas(
        createElement("Box", { id: "behind", width: 200, height: 100, ...REFERENCES }),
        createElement("Box", {
          id: "blocker",
          position: "absolute",
          width: 200,
          height: 100,
          background: "blue",
        }),
      ),
    );
    await flush(page);
    expect(await page.evaluate(() => window.boundsvgLive.read().hoverChanges)).toEqual(["blocker"]);
    await mount(page, witnessScene(false, { width: 240, height: 140 }), { adapter });
    await page.mouse.click(130, 60);
    expect(
      await page.evaluate(() =>
        window.boundsvgLive.read().deliveries.filter((event) => event.nativeType === "click"),
      ),
    ).toEqual([expect.objectContaining({ nodeId: "outer", handlerName: "outerClick" })]);
  });
}
