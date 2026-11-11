import type { IR, IRNode } from "@boundsvg/core";
import { buildIRSourceIndex } from "@boundsvg/core/scene";

/** Emit explicit test paint with canonical metadata; this is not a layout/emitter oracle. */
export function svgForIr(ir: IR, color = "red"): string {
  const index = buildIRSourceIndex(ir);
  const ordinals = new Map(
    [...index.nodes.values()].map((occurrence) => [occurrence.node, occurrence]),
  );
  function emit(node: IRNode): string {
    const occurrence = ordinals.get(node);
    if (!occurrence) {
      throw new TypeError("Missing test occurrence");
    }
    const attributes = `data-boundsvg-node-index="${occurrence.nodeIndex}" data-boundsvg-source-index="${occurrence.source.sourceIndex}" data-boundsvg-role="${node.ownership.role}"${node.ownership.role === "source" ? ` data-boundsvg-node-id="${node.nodeId}"` : ""}`;
    if (node.type === "group") {
      return `<g ${attributes}>${node.children?.map(emit).join("") ?? ""}</g>`;
    }
    const ink = `<path data-test-paint="true" d="M0 0H100V100H0Z" fill="${color}"/>`;
    if (node.type === "text") {
      return `<g ${attributes}>${ink}</g>`;
    }
    if (node.type === "rect") {
      return `<rect ${attributes} width="100" height="100" fill="${color}"/>`;
    }
    if (node.type === "image") {
      return `<image ${attributes}/>`;
    }
    return `<svg ${attributes}>${ink}</svg>`;
  }
  return `<svg viewBox="0 0 ${ir.width} ${ir.height}" width="${ir.width}" height="${ir.height}">${emit(ir.root)}</svg>`;
}

/** Supply only native DOM primitives absent from happy-dom, leaving production queries intact. */
export function installSvgDomPrimitives(topAt?: (x: number, y: number) => Element | null): void {
  Object.defineProperty(SVGElement.prototype, "computedStyleMap", {
    configurable: true,
    value() {
      return { get: () => ({ value: "none" }) };
    },
  });
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    },
  });
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value(x: number, y: number) {
      if (topAt) {
        const top = topAt(x, y);
        return top ? [top] : [];
      }
      const root = [...document.querySelectorAll("svg")]
        .filter((svg) => svg.ownerSVGElement === null)
        .at(-1);
      if (!root) {
        return [];
      }
      const top =
        x >= 0 && x < 100 && y >= 0 && y < 100
          ? (root.querySelector("[data-test-paint],path,rect,text,image") ?? root)
          : root;
      return [top];
    },
  });
}
