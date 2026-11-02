import type {
  Engine,
  IR,
  IRNode,
  IRNodeOwnership,
  IRSourceRef,
  SceneInspection,
} from "../../dist/index.js";
import { collectInspectionBBoxes } from "../../dist/inspect.js";
import {
  buildHitTestIndex,
  buildIRSourceIndex,
  buildTextMap,
  buildTextSelectionMap,
  getNodeText,
} from "../../dist/scene.js";

declare const engine: Engine;
declare const ir: IR;
declare const inspection: SceneInspection;
const hit: IRSourceRef | null = engine.hitTest(ir, 10, 20);
const indexedHit: IRSourceRef | null = buildHitTestIndex(ir).queryTopmost(10, 20);
const source = buildIRSourceIndex(ir).sources.get(0)?.source;
const textMap = buildTextMap(buildIRSourceIndex(ir));
const preparedIndex = buildIRSourceIndex(ir);
buildTextSelectionMap(preparedIndex);
collectInspectionBBoxes(preparedIndex);
// @ts-expect-error projections accept one prepared index, not an IR
buildTextMap(ir);
// @ts-expect-error the redundant IR/index pair is removed
buildTextMap(ir, preparedIndex);
// @ts-expect-error the redundant IR/index pair is removed
buildTextSelectionMap(ir, preparedIndex);
// @ts-expect-error the redundant IR/index pair is removed
collectInspectionBBoxes(ir, preparedIndex);
// @ts-expect-error copy queries require a canonical source reference, not an ordinal
getNodeText(textMap, 0);
// @ts-expect-error ancestry is owned by sourceIndex
textMap.parentMap;
void [hit, indexedHit, source];

const sourceOwnership: IRNodeOwnership = {
  role: "source",
  on: { onClick: "select" },
  meta: { kind: "card" },
};
const contentOwnership: IRNodeOwnership = { role: "content", ownerNodeId: "card" };
const decorationOwnership: IRNodeOwnership = { role: "decoration", ownerNodeId: "card" };
const wrapperOwnership: IRNodeOwnership = {
  role: "wrapper",
  placement: "outer",
  ownerNodeId: "card",
};
void [sourceOwnership, contentOwnership, decorationOwnership, wrapperOwnership];

// @ts-expect-error every physical node requires explicit ownership
const missingOwnership: IRNode = {
  type: "rect",
  nodeId: "card",
  bbox: { x: 0, y: 0, w: 10, h: 10 },
};
const contentHandlers: IRNodeOwnership = {
  role: "content",
  ownerNodeId: "card",
  // @ts-expect-error callback references belong only to source ownership
  on: { onClick: "select" },
};
// @ts-expect-error a source is its own semantic owner
const sourceOwner: IRNodeOwnership = { role: "source", ownerNodeId: "card" };
// @ts-expect-error wrapper placement is required
const missingPlacement: IRNodeOwnership = { role: "wrapper", ownerNodeId: "card" };
// @ts-expect-error text lookup uses snapshot-local source ordinals
textMap.nodes.get("card");
// @ts-expect-error painting order is derived from tree occurrences
ir.drawOrder;
// @ts-expect-error source facts are available through the common source index
inspection.handlerMap;
// @ts-expect-error physical inspection geometry uses layoutBBox
inspection.bboxes[0]?.x;
void [missingOwnership, contentHandlers, sourceOwner, missingPlacement];

if (hit) {
  // @ts-expect-error snapshot source references are readonly
  hit.sourceIndex = 1;
}
