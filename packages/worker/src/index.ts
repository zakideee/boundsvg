// Error rehydration
export { rehydrateError } from "./error-rehydration.js";
export type { WorkerLayoutTransitionInput } from "./layout-transition-transport.js";
export {
  isWorkerLayoutTransitionInput,
  MAX_WORKER_LAYOUT_TRANSITION_PAYLOAD_BYTES,
  snapshotWorkerLayoutTransitionInput,
} from "./layout-transition-transport.js";
export type {
  CloseFrameStreamOkResponse,
  CloseFrameStreamRequest,
  DisposeOkResponse,
  DisposeRequest,
  ErrorResponse,
  FontTransfer,
  IndexedFrameTime,
  InitOkResponse,
  InitRequest,
  NextFrameStreamOkResponse,
  NextFrameStreamRequest,
  OpenFrameStreamOkResponse,
  OpenFrameStreamRequest,
  OpenLayoutTransitionFrameStreamRequest,
  RenderAnimatedGifOkResponse,
  RenderAnimatedGifRequest,
  RenderAnimatedSvgAndIrOkResponse,
  RenderAnimatedSvgAndIrRequest,
  RenderAnimatedSvgOkResponse,
  RenderAnimatedSvgRequest,
  RenderAnimatedWebpOkResponse,
  RenderAnimatedWebpRequest,
  RenderLayeredPngOkResponse,
  RenderLayeredPngRequest,
  RenderLayeredSvgOkResponse,
  RenderLayeredSvgRequest,
  RenderLayoutTransitionAnimatedGifRequest,
  RenderLayoutTransitionAnimatedWebpRequest,
  RenderPngOkResponse,
  RenderPngRequest,
  RenderSvgAndIrOkResponse,
  RenderSvgAndIrRequest,
  RenderSvgOkResponse,
  RenderSvgRequest,
  RenderWebpOkResponse,
  RenderWebpRequest,
  WorkerAnimatedGifRenderOptions,
  WorkerAnimatedWebpRenderOptions,
  WorkerFrameRenderOptions,
  WorkerIR,
  WorkerLayeredPngRenderOptions,
  WorkerLayeredPngResult,
  WorkerLayeredSvgRenderOptions,
  WorkerLayeredSvgResult,
  WorkerRenderAnimatedSvgOptions,
  WorkerRenderPngOptions,
  WorkerRenderSvgOptions,
  WorkerRenderWebpOptions,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js";
// Type guards and helpers
export {
  collectRequestTransferables,
  collectResponseTransferables,
  isWorkerRequest,
  isWorkerResponse,
} from "./protocol.js";
export type {
  WorkerEngineOptions,
  WorkerRenderLayeredPngResult,
  WorkerRenderLayeredSvgResult,
  WorkerRenderPngResult,
  WorkerRenderSvgAndIrResult,
  WorkerRenderSvgResult,
} from "./worker-engine.js";
// WorkerEngine proxy
export { WorkerEngine } from "./worker-engine.js";
export type {
  MaterializedFrameInput,
  MaterializedFrameSource,
  WorkerPoolMaterializedFramesOptions,
  WorkerPoolOptions,
  WorkerPoolRenderFramesOptions,
  WorkerPoolWorkerFactory,
} from "./worker-pool.js";
export {
  DEFAULT_WORKER_POOL_CONCURRENCY,
  MAX_WORKER_POOL_CONCURRENCY,
  WorkerPool,
} from "./worker-pool.js";
