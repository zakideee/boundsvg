import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import {
  type AssetRenderCacheEntry,
  assetRenderCacheAtom,
  setAssetRenderCacheEntryAtom,
} from "../src/editor/atoms.js";

test("asset subscribers ignore repeated defensive PNG copies and observe changed results", () => {
  const store = createStore();
  let notifications = 0;
  const unsubscribe = store.sub(assetRenderCacheAtom, () => {
    notifications += 1;
  });
  const entry: AssetRenderCacheEntry = {
    svg: "<svg/>",
    png: new Uint8Array([1, 2, 3]),
    dataUrl: "data:image/png;base64,AQID",
    isReady: true,
    error: null,
    canvasSize: { width: 20, height: 30 },
  };
  store.set(setAssetRenderCacheEntryAtom, { id: "badge", entry });
  const initialCache = store.get(assetRenderCacheAtom);
  for (let index = 0; index < 100; index++) {
    store.set(setAssetRenderCacheEntryAtom, {
      id: "badge",
      entry: { ...entry, png: entry.png?.slice() ?? null, canvasSize: { ...entry.canvasSize } },
    });
  }
  assert.equal(notifications, 1);
  assert.equal(store.get(assetRenderCacheAtom), initialCache);
  const next = { ...entry, png: new Uint8Array([4]), dataUrl: "data:image/png;base64,BA==" };
  store.set(setAssetRenderCacheEntryAtom, { id: "badge", entry: next });
  assert.equal(notifications, 2);
  assert.equal(store.get(assetRenderCacheAtom).badge, next);
  store.set(setAssetRenderCacheEntryAtom, {
    id: "badge",
    entry: { ...next, png: null, dataUrl: null, isReady: false, error: "render failed" },
  });
  assert.equal(notifications, 3);
  unsubscribe();
});
