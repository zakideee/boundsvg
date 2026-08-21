import type { IR } from "@boundsvg/core";
import {
  findLineAtPoint,
  getAllText,
  getAncestorText,
  getNodeText,
  type TextMap,
} from "@boundsvg/core/scene";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

const COPY_STATUS_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Copy status feedback */
export type CopyStatus = "idle" | "copied" | "failed";

/** Information passed to onTextCopyMenu callback */
export type TextCopyMenuInfo = {
  nodeId: string;
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
  nodeId: string;
  svgX: number;
  svgY: number;
  clientX: number;
  clientY: number;
};

/** Result of useTextCopy hook */
export type UseTextCopyResult = {
  textMap: TextMap | null;
  copyToClipboard: (text: string) => Promise<boolean>;
  resolveNodeText: (nodeId: string) => string | null;
  resolveLineText: (nodeId: string, point: SvgPoint) => string | null;
  resolveAncestorText: (nodeId: string) => string | null;
  resolveAllText: () => string;
  copyNodeText: (nodeId: string) => Promise<boolean>;
  copyLineText: (nodeId: string, point: SvgPoint) => Promise<boolean>;
  copyAncestorText: (nodeId: string) => Promise<boolean>;
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

export function useTextCopy(ir: IR | null, textMap: TextMap | null): UseTextCopyResult {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(0 as never);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const irRef = useRef(ir);
  const textMapRef = useRef(textMap);
  useLayoutEffect(() => {
    irRef.current = ir;
    textMapRef.current = textMap;
  }, [ir, textMap]);

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

  const resolveNodeText = useCallback((nodeId: string): string | null => {
    if (!textMapRef.current) {
      return null;
    }
    return getNodeText(textMapRef.current, nodeId);
  }, []);

  const resolveLineText = useCallback((nodeId: string, point: SvgPoint): string | null => {
    if (!textMapRef.current) {
      return null;
    }
    const line = findLineAtPoint(textMapRef.current, nodeId, point);
    return line?.text ?? null;
  }, []);

  const resolveAncestorText = useCallback((nodeId: string): string | null => {
    if (!textMapRef.current) {
      return null;
    }
    return getAncestorText(textMapRef.current, nodeId);
  }, []);

  const resolveAllText = useCallback((): string => {
    if (!textMapRef.current || !irRef.current) {
      return "";
    }
    return getAllText(textMapRef.current, irRef.current.drawOrder);
  }, []);

  const copyNodeText = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const text = resolveNodeText(nodeId);
      if (!text) {
        return false;
      }
      return copyToClipboard(text);
    },
    [resolveNodeText, copyToClipboard],
  );

  const copyLineText = useCallback(
    async (nodeId: string, point: SvgPoint): Promise<boolean> => {
      const text = resolveLineText(nodeId, point);
      if (!text) {
        return false;
      }
      return copyToClipboard(text);
    },
    [resolveLineText, copyToClipboard],
  );

  const copyAncestorText = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const text = resolveAncestorText(nodeId);
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
      nodeId: params.nodeId,
      svgX: params.svgX,
      svgY: params.svgY,
      clientX: params.clientX,
      clientY: params.clientY,
      nodeText: resolveNodeText(params.nodeId),
      lineText: resolveLineText(params.nodeId, { svgX: params.svgX, svgY: params.svgY }),
      ancestorText: resolveAncestorText(params.nodeId),
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
