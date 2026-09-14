import { Engine, type VNode } from "@boundsvg/core";
import type { WorkerEngine } from "@boundsvg/worker";

export function makeEngineMock(value: Partial<Engine>): Engine {
  return Object.assign(new Engine({ computeLayoutFn: () => "" }), value);
}

export function makeWorkerEngineMock(value: Partial<WorkerEngine>): WorkerEngine {
  return value as WorkerEngine;
}

export function makeInvalidVNode(value: object): VNode {
  return value as VNode;
}
