/** Default font weight for CSS `normal`. */
export const DEFAULT_FONT_WEIGHT = 400;

/** Input for registering a font face */
export type FontFaceInput = {
  alias: string;
  data: Uint8Array;
  weight?: number; // default DEFAULT_FONT_WEIGHT
  style?: "normal" | "italic"; // default "normal"
};

/** Options for font registration */
export type RegisterFontsOptions = {
  onDuplicate?: "error" | "replace" | "skip"; // default "error"
};

/** Internal font entry stored in the registry */
export type FontEntry = {
  alias: string;
  weight: number;
  style: "normal" | "italic";
  data: Uint8Array;
};
