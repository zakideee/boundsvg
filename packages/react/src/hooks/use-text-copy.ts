import type { IRSourceRef } from "@boundsvg/core/scene";
import {
  findLineAtPoint,
  getAllText,
  getAncestorText,
  getNodeText,
  type TextMap,
} from "@boundsvg/core/scene";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

/** Clipboard feedback lifetime in ms after the latest completed copy request. */
const COPY_STATUS_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Copy status feedback */
export type CopyStatus = "idle" | "copied" | "failed";

/** Information passed to onTextCopyMenu callback */
export type TextCopyMenuInfo = {
  source: IRSourceRef;
  svgX: number;
  svgY: number;
  clientX: number;
  clientY: number;
  /** Text of the hit node */
  nodeText: string | null;
  /** Text of the line under the cursor */
  lineText: string | null;
  /** Concatenated text of ancestor group */
  ancestorText: string | null;
  /** All canvas text */
  allText: string;
  /** Copy utility — writes text to clipboard with status feedback */
  copyToClipboard: (text: string) => Promise<boolean>;
};

/** Coordinate pair for line-level queries */
export type SvgPoint = { svgX: number; svgY: number };

/** Parameters for buildMenuInfo */
export type BuildMenuInfoParams = {
  source: IRSourceRef;
  svgX: number;
  svgY: number;
  clientX: number;
  clientY: number;
};

/** Result of useTextCopy hook */
export type UseTextCopyResult = {
  textMap: TextMap | null;
  copyToClipboard: (text: string) => Promise<boolean>;
  resolveNodeText: (source: IRSourceRef) => string | null;
  resolveLineText: (source: IRSourceRef, point: SvgPoint) => string | null;
  resolveAncestorText: (source: IRSourceRef) => string | null;
  resolveAllText: () => string;
  copyNodeText: (source: IRSourceRef) => Promise<boolean>;
  copyLineText: (source: IRSourceRef, point: SvgPoint) => Promise<boolean>;
  copyAncestorText: (source: IRSourceRef) => Promise<boolean>;
  copyAllText: () => Promise<boolean>;
  copyStatus: CopyStatus;
  /** Build a TextCopyMenuInfo for a given hit target. Used by InteractiveBoundSvg internally. */
  buildMenuInfo: (params: BuildMenuInfoParams) => TextCopyMenuInfo;
};

// ---------------------------------------------------------------------------
// Clipboard utility
// ---------------------------------------------------------------------------

async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy fallback
    }
  }

  if (typeof document !== "undefined") {
    let textarea: HTMLTextAreaElement | null = null;
    try {
      textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea?.remove();
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Copy primary text from the current snapshot and report asynchronous clipboard status. */
export function useTextCopy(textMap: TextMap | null): UseTextCopyResult {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(0 as never);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const textMapRef = useRef(textMap);
  useLayoutEffect(() => {
    textMapRef.current = textMap;
  }, [textMap]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      clearTimeout(statusTimerRef.current);
    };
  }, []);

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    const requestGeneration = ++requestGenerationRef.current;
    clearTimeout(statusTimerRef.current);
    const ok = await writeClipboard(text);
    if (!mountedRef.current || requestGenerationRef.current !== requestGeneration) {
      return ok;
    }
    setCopyStatus(ok ? "copied" : "failed");
    statusTimerRef.current = setTimeout(() => {
      if (mountedRef.current && requestGenerationRef.current === requestGeneration) {
        setCopyStatus("idle");
      }
    }, COPY_STATUS_TIMEOUT_MS);
    return ok;
  }, []);

  const resolveNodeText = useCallback((source: IRSourceRef): string | null => {
    if (!textMapRef.current) {
      return null;
    }
    return getNodeText(textMapRef.current, source);
  }, []);

  const resolveLineText = useCallback((source: IRSourceRef, point: SvgPoint): string | null => {
    if (!textMapRef.current) {
      return null;
    }
    const line = findLineAtPoint(textMapRef.current, source, point);
    return line?.text ?? null;
  }, []);

  const resolveAncestorText = useCallback((source: IRSourceRef): string | null => {
    if (!textMapRef.current) {
      return null;
    }
    return getAncestorText(textMapRef.current, source);
  }, []);

  const resolveAllText = useCallback((): string => {
    if (!textMapRef.current) {
      return "";
    }
    return getAllText(textMapRef.current);
  }, []);

  const copyNodeText = useCallback(
    async (source: IRSourceRef): Promise<boolean> => {
      const text = resolveNodeText(source);
      if (!text) {
        return false;
      }
      return copyToClipboard(text);
    },
    [resolveNodeText, copyToClipboard],
  );

  const copyLineText = useCallback(
    async (source: IRSourceRef, point: SvgPoint): Promise<boolean> => {
      const text = resolveLineText(source, point);
      if (!text) {
        return false;
      }
      return copyToClipboard(text);
    },
    [resolveLineText, copyToClipboard],
  );

  const copyAncestorText = useCallback(
    async (source: IRSourceRef): Promise<boolean> => {
      const text = resolveAncestorText(source);
      if (!text) {
        return false;
      }
      return copyToClipboard(text);
    },
    [resolveAncestorText, copyToClipboard],
  );

  const copyAllText = useCallback(async (): Promise<boolean> => {
    const text = resolveAllText();
    if (!text) {
      return false;
    }
    return copyToClipboard(text);
  }, [resolveAllText, copyToClipboard]);

  const buildMenuInfo = useCallback(
    (params: BuildMenuInfoParams): TextCopyMenuInfo => ({
      source: params.source,
      svgX: params.svgX,
      svgY: params.svgY,
      clientX: params.clientX,
      clientY: params.clientY,
      nodeText: resolveNodeText(params.source),
      lineText: resolveLineText(params.source, { svgX: params.svgX, svgY: params.svgY }),
      ancestorText: resolveAncestorText(params.source),
      allText: resolveAllText(),
      copyToClipboard,
    }),
    [resolveNodeText, resolveLineText, resolveAncestorText, resolveAllText, copyToClipboard],
  );

  return useMemo(
    () => ({
      textMap,
      copyToClipboard,
      resolveNodeText,
      resolveLineText,
      resolveAncestorText,
      resolveAllText,
      copyNodeText,
      copyLineText,
      copyAncestorText,
      copyAllText,
      copyStatus,
      buildMenuInfo,
    }),
    [
      textMap,
      copyToClipboard,
      resolveNodeText,
      resolveLineText,
      resolveAncestorText,
      resolveAllText,
      copyNodeText,
      copyLineText,
      copyAncestorText,
      copyAllText,
      copyStatus,
      buildMenuInfo,
    ],
  );
}
