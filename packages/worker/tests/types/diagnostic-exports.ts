// @ts-expect-error The generic diagnostic rehydrator was removed from the Worker declaration surface.
import { rehydrateError, type WorkerRenderSvgAndIrResult } from "../../dist/index.js";

void rehydrateError;

declare const svgAndIr: WorkerRenderSvgAndIrResult;
void svgAndIr.ir.warnings;
// @ts-expect-error The retained IR is the sole public warning authority.
void svgAndIr.warnings;
