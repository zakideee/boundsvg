import { atom } from "jotai";

// Keep app-local state as plain data only. VNodes, IR trees, and handler maps are
// derived inside render components so the atom graph stays simple and portable.
export const EDITOR_ASSET_IDS = ["headline", "badge", "stamp"] as const;

export type EditorAssetId = (typeof EDITOR_ASSET_IDS)[number];
export type EditorFontKey = "sans" | "serif" | "rounded";

export type EditorAssetState = {
  text: string;
  fontKey: EditorFontKey;
  backgroundColor: string;
  accentColor: string;
  textColor: string;
  canvasWidth: number;
  canvasHeight: number;
};

export type CompositionPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AssetRenderCacheEntry = {
  svg: string | null;
  png: Uint8Array | null;
  dataUrl: string | null;
  isReady: boolean;
  error: string | null;
  canvasSize: {
    width: number;
    height: number;
  };
};

type AssetStateMap = Record<EditorAssetId, EditorAssetState>;
export type CompositionPlacementMap = Record<EditorAssetId, CompositionPlacement>;
export type AssetRenderCacheMap = Record<EditorAssetId, AssetRenderCacheEntry>;

export const assetStatesAtom = atom<AssetStateMap>({
  headline: {
    text: "BREAKING NEWS",
    fontKey: "sans",
    backgroundColor: "#fffbeb",
    accentColor: "#f59e0b",
    textColor: "#0f172a",
    canvasWidth: 520,
    canvasHeight: 190,
  },
  badge: {
    text: "LIMITED",
    fontKey: "sans",
    backgroundColor: "#0f2744",
    accentColor: "#1d4ed8",
    textColor: "#facc15",
    canvasWidth: 280,
    canvasHeight: 150,
  },
  stamp: {
    text: "APPROVED",
    fontKey: "rounded",
    backgroundColor: "#2d2d2d",
    accentColor: "#f43f5e",
    textColor: "#fda4af",
    canvasWidth: 230,
    canvasHeight: 230,
  },
});

export const compositionPlacementsAtom = atom<CompositionPlacementMap>({
  headline: { x: 36, y: 388, width: 520, height: 190 },
  badge: { x: 630, y: 60, width: 280, height: 150 },
  stamp: { x: 668, y: 356, width: 230, height: 230 },
});

export const assetRenderCacheAtom = atom<AssetRenderCacheMap>({
  headline: {
    svg: null,
    png: null,
    dataUrl: null,
    isReady: false,
    error: null,
    canvasSize: { width: 520, height: 190 },
  },
  badge: {
    svg: null,
    png: null,
    dataUrl: null,
    isReady: false,
    error: null,
    canvasSize: { width: 280, height: 150 },
  },
  stamp: {
    svg: null,
    png: null,
    dataUrl: null,
    isReady: false,
    error: null,
    canvasSize: { width: 230, height: 230 },
  },
});

export const selectedAssetIdAtom = atom<EditorAssetId | null>("headline");
export const exportScaleAtom = atom(2);

export const patchAssetStateAtom = atom(
  null,
  (
    _get,
    set,
    payload: {
      id: EditorAssetId;
      patch: Partial<EditorAssetState>;
    },
  ) => {
    set(assetStatesAtom, (prev) => ({
      ...prev,
      [payload.id]: {
        ...prev[payload.id],
        ...payload.patch,
      },
    }));
  },
);

export const patchCompositionPlacementAtom = atom(
  null,
  (
    _get,
    set,
    payload: {
      id: EditorAssetId;
      patch: Partial<CompositionPlacement>;
    },
  ) => {
    set(compositionPlacementsAtom, (prev) => ({
      ...prev,
      [payload.id]: {
        ...prev[payload.id],
        ...payload.patch,
      },
    }));
  },
);

export const setAssetRenderCacheEntryAtom = atom(
  null,
  (
    _get,
    set,
    payload: {
      id: EditorAssetId;
      entry: AssetRenderCacheEntry;
    },
  ) => {
    set(assetRenderCacheAtom, (prev) => ({
      ...prev,
      [payload.id]: payload.entry,
    }));
  },
);
