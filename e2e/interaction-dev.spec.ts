import { createElement } from "@boundsvg/core";
import { expect, test } from "@playwright/test";
import type {} from "../apps/playground-react/src/e2e/e2e-live-interaction-harness.js";

test("development StrictMode replays actual React effects and keeps interaction attached", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.metadata.isDevelopment !== true,
    "Requires the development React runtime",
  );
  await page.goto("/e2e-live-interaction.html");
  await page.waitForFunction(() => !!window.boundsvgLive);
  const input = createElement(
    "Canvas",
    { width: 200, height: 100 },
    createElement("Box", { id: "A", width: 100, height: 100, onClick: "click" }),
  );
  await page.evaluate(
    (vnode) =>
      window.boundsvgLive.mount(vnode, { adapter: "react", scope: "document", animated: false }),
    input,
  );
  await page.waitForFunction(
    () => window.boundsvgLive.read().ready && window.boundsvgLive.read().reactEffects.started === 2,
  );
  await page.mouse.click(50, 50);
  const snapshot = await page.evaluate(() => window.boundsvgLive.read());
  expect(snapshot.reactEffects).toEqual({ started: 2, cleaned: 1 });
  expect(snapshot.deliveries.filter((delivery) => delivery.handlerName === "click")).toHaveLength(
    1,
  );
  await testInfo.attach("development-StrictMode", {
    body: JSON.stringify(snapshot),
    contentType: "application/json",
  });
});
