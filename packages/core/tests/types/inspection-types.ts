import {
  type CompiledScene,
  type Engine,
  type InspectionBBox,
  type IR,
  inspectScene,
  type LayoutRenderOptions,
  type SceneInspection,
  snapshotCompiledIR,
  type VNode,
} from "../../dist/index.js";
import { collectInspectionBBoxes } from "../../dist/inspect.js";

declare const engine: Engine;
declare const scene: VNode;
declare const compiled: CompiledScene;

const layoutOptions: LayoutRenderOptions = { skipValidation: true };
const inspection: SceneInspection = inspectScene(engine, scene, { timeMs: 120 });
const bbox: InspectionBBox | undefined = inspection.bboxes[0];
const collected: InspectionBBox[] = collectInspectionBBoxes(inspection.ir);
engine.renderToLayoutTree(scene, layoutOptions);
void bbox;
void collected;

const engineSnapshot: IR = engine.snapshotCompiledIR(compiled);
const defaultSnapshot: IR = snapshotCompiledIR(compiled);
void engineSnapshot;
void defaultSnapshot;

// @ts-expect-error CompiledScene is nominal and cannot be constructed structurally
const structuralCompiled: CompiledScene = {
  width: 100,
  height: 100,
  textPathMode: "merged",
};
void structuralCompiled;

// @ts-expect-error private render state is available only through snapshotCompiledIR
compiled.ir;

// @ts-expect-error compiled metadata is readonly
compiled.width = 10;

// @ts-expect-error animation is sampled after layout and is not a layout-tree option
engine.renderToLayoutTree(scene, { timeMs: 120 });
