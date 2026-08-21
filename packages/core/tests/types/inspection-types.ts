import {
  type Engine,
  type InspectionBBox,
  inspectScene,
  type LayoutRenderOptions,
  type SceneInspection,
  type VNode,
} from "../../dist/index.js";
import { collectInspectionBBoxes } from "../../dist/inspect.js";

declare const engine: Engine;
declare const scene: VNode;

const layoutOptions: LayoutRenderOptions = { skipValidation: true };
const inspection: SceneInspection = inspectScene(engine, scene, { timeMs: 120 });
const bbox: InspectionBBox | undefined = inspection.bboxes[0];
const collected: InspectionBBox[] = collectInspectionBBoxes(inspection.ir);
engine.renderToLayoutTree(scene, layoutOptions);
void bbox;
void collected;

// @ts-expect-error animation is sampled after layout and is not a layout-tree option
engine.renderToLayoutTree(scene, { timeMs: 120 });
