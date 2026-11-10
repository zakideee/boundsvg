import assert from "node:assert/strict";
import test from "node:test";
import { liveInteractionPreset } from "../../playground-core/src/presets/live-interaction.ts";
import { LIVE_INTERACTION_TEMPLATE } from "../src/pages/templates/live-interaction.tsx";

test("Core and JSX live interaction samples have identical author inputs", () => {
  assert.ok(LIVE_INTERACTION_TEMPLATE.vnode);
  assert.deepEqual(LIVE_INTERACTION_TEMPLATE.vnode, liveInteractionPreset.build());
  assert.equal(LIVE_INTERACTION_TEMPLATE.animatedSvgOptions?.playback?.mode, "independent");
});
