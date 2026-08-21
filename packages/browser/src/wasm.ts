import type { WasmModule } from "@boundsvg/core/wasm";
import { scalarWasm, scalarWasmInit, simdWasm, simdWasmInit } from "./generated-wasm.js";

type GeneratedWasm = typeof simdWasm;
type WasmVariant = {
  init: typeof simdWasmInit;
  wasm: GeneratedWasm;
};

const wasmVariants: readonly WasmVariant[] = [
  { init: simdWasmInit, wasm: simdWasm },
  { init: scalarWasmInit, wasm: scalarWasm },
];

let cachedModule: WasmModule | null = null;
let loadingPromise: Promise<WasmModule> | null = null;

export type LoadWasmModuleOptions = {
  /**
   * Pre-compiled WASM module to instantiate instead of fetching the binary
   * by URL. Required in runtimes without URL-based asset fetching — e.g.
   * Cloudflare workerd, where the bundler provides the `.wasm` file as a
   * `WebAssembly.Module` import. Ignored once a module is initialized
   * (first caller wins).
   */
  wasmModule?: WebAssembly.Module;
};

/**
 * Load and initialize the WASM module for browser usage.
 * Fetches the .wasm binary (or instantiates a supplied precompiled module)
 * and returns a WasmModule adapter.
 * Safe to call multiple times - subsequent calls return the cached module.
 */
export async function loadWasmModule(options?: LoadWasmModuleOptions): Promise<WasmModule> {
  if (cachedModule) {
    return cachedModule;
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    // A caller-supplied module is already an explicit choice, so preserve the
    // existing single-module behavior. Automatic loading tries SIMD first and
    // then uses the scalar artifact when the runtime rejects SIMD.
    const variants = options?.wasmModule ? wasmVariants.slice(0, 1) : wasmVariants;
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        if (options?.wasmModule) {
          await variant.init({ module_or_path: options.wasmModule });
        } else {
          await variant.init();
        }

        const wasmAdapter = createWasmModule(variant.wasm);
        cachedModule = wasmAdapter;
        return wasmAdapter;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("No compatible boundsvg WASM variant could be loaded.");
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

function createWasmModule(generatedWasm: GeneratedWasm): WasmModule {
  const getFontMetrics = requireWasmFunction(generatedWasm.get_font_metrics, "get_font_metrics");
  const shapeText = requireWasmFunction(generatedWasm.shape_text, "shape_text");
  const graphemeSplit = requireWasmFunction(generatedWasm.grapheme_split, "grapheme_split");
  const compileShapeSvg = requireWasmFunction(generatedWasm.compile_shape_svg, "compile_shape_svg");
  const compileShapePaths = requireWasmFunction(
    generatedWasm.compile_shape_paths,
    "compile_shape_paths",
  );
  const hitTestShapeParts = requireWasmFunction(
    generatedWasm.hit_test_shape_parts,
    "hit_test_shape_parts",
  );
  const resolveSymbolGeometry = requireWasmFunction(
    generatedWasm.resolve_symbol_geometry,
    "resolve_symbol_geometry",
  );
  const evaluateShapeRegion = requireWasmFunction(
    generatedWasm.evaluate_shape_region,
    "evaluate_shape_region",
  );
  const renderShapeRegionSvg = requireWasmFunction(
    generatedWasm.render_shape_region_svg,
    "render_shape_region_svg",
  );
  const divideShapeRegions = requireWasmFunction(
    generatedWasm.divide_shape_regions,
    "divide_shape_regions",
  );
  const computeShapeIntersections = requireWasmFunction(
    generatedWasm.compute_shape_intersections,
    "compute_shape_intersections",
  );
  const boundSvgEngine = requireWasmConstructor(generatedWasm.BoundSvgEngine, "BoundSvgEngine");

  // Map web-target exports to the WasmModule interface.
  return {
    get_font_metrics: (font_data: Uint8Array) => getFontMetrics(font_data),
    shape_text: (
      font_data: Uint8Array,
      text: string,
      font_size_px: number,
      letter_spacing_px: number,
    ) => shapeText(font_data, text, font_size_px, letter_spacing_px),
    grapheme_split: (text: string) => graphemeSplit(text),
    wasm_schema_version: generatedWasm.wasm_schema_version
      ? () => generatedWasm.wasm_schema_version()
      : undefined,
    uax14_line_breaks: (text: string) => generatedWasm.uax14_line_breaks(text),
    extract_image_hrefs: (svg_string: string) => generatedWasm.extract_image_hrefs(svg_string),
    extract_skipped_image_hrefs: generatedWasm.extract_skipped_image_hrefs
      ? (svg_string: string) => generatedWasm.extract_skipped_image_hrefs(svg_string)
      : undefined,
    replace_image_hrefs: generatedWasm.replace_image_hrefs
      ? (svg_string: string, replacements_json: string) =>
          generatedWasm.replace_image_hrefs?.(svg_string, replacements_json)
      : undefined,
    compile_shape_svg: (json_input: string) => compileShapeSvg(json_input),
    compile_shape_paths: (json_input: string) => compileShapePaths(json_input),
    hit_test_shape_parts: (json_input: string) => hitTestShapeParts(json_input),
    resolve_symbol_geometry: (json_input: string) => resolveSymbolGeometry(json_input),
    evaluate_shape_region: (json_input: string) => evaluateShapeRegion(json_input),
    evaluate_shape_parts: generatedWasm.evaluate_shape_parts
      ? (json_input: string) => generatedWasm.evaluate_shape_parts?.(json_input)
      : undefined,
    render_shape_region_svg: (json_input: string) => renderShapeRegionSvg(json_input),
    divide_shape_regions: (json_input: string) => divideShapeRegions(json_input),
    compute_shape_intersections: (json_input: string) => computeShapeIntersections(json_input),
    BoundSvgEngine: boundSvgEngine,
  };
}

function requireWasmFunction<T extends (...args: never[]) => unknown>(
  value: T | undefined,
  name: string,
): T {
  if (typeof value !== "function") {
    throw new Error(
      `Browser WASM module is missing required export "${name}". Rebuild WASM and @boundsvg/browser.`,
    );
  }
  return value;
}

function requireWasmConstructor<T extends abstract new (...args: never[]) => unknown>(
  value: T | undefined,
  name: string,
): T {
  if (typeof value !== "function") {
    throw new Error(
      `Browser WASM module is missing required export "${name}". Rebuild WASM and @boundsvg/browser.`,
    );
  }
  return value;
}
