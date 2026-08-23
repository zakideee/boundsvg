import { useLayoutEffect, useSyncExternalStore } from "react";

const MOBILE_VIEWER_QUERY =
  "(max-width: 820px), (max-height: 560px) and (hover: none) and (pointer: coarse)";

function subscribeToMobileViewer(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(MOBILE_VIEWER_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getMobileViewerSnapshot(): boolean {
  return window.matchMedia(MOBILE_VIEWER_QUERY).matches;
}

function getServerMobileViewerSnapshot(): boolean {
  return false;
}

/** Phone-width mode keeps the playground focused on viewing and simple controls. */
export function useMobileViewer(): boolean {
  return useSyncExternalStore(
    subscribeToMobileViewer,
    getMobileViewerSnapshot,
    getServerMobileViewerSnapshot,
  );
}

/** Reset source-only presentation state without remounting the active sample. */
export function useResetPreviewForMobile(
  mobileViewer: boolean,
  setViewTab: (viewTab: "preview") => void,
  setCodeLayout: (codeLayout: "tab") => void,
): void {
  useLayoutEffect(() => {
    if (!mobileViewer) {
      return;
    }
    setViewTab("preview");
    setCodeLayout("tab");
  }, [mobileViewer, setCodeLayout, setViewTab]);
}
