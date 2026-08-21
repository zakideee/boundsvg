// Minimal ambient declaration for Node.js Buffer.
// Used behind `typeof Buffer !== "undefined"` runtime guards for base64 encoding.
// In browser environments Buffer is undefined — guarded branches are skipped.
declare const Buffer: {
  from(
    data: Uint8Array | ArrayBuffer | string,
    encoding?: string,
  ): { toString(encoding: string): string };
};
