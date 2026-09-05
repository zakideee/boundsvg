import { failRelease, ReleaseControlError } from "./errors.mjs";

const defaultRequestTimeoutMs = 30_000;
const supportedContentEncodings = new Set(["br", "deflate", "gzip", "identity"]);

export function boundedRequestSignal(signal, timeoutMs = defaultRequestTimeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    failRelease("NETWORK_TIMEOUT_INVALID", "request timeout is outside the supported bound");
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (signal === undefined) {
    return timeoutSignal;
  }
  try {
    return AbortSignal.any([signal, timeoutSignal]);
  } catch (error) {
    failRelease("NETWORK_SIGNAL_INVALID", "request signal is invalid", { cause: error });
  }
}

function declaredResponseLength(response, errorCode, label) {
  const value = response?.headers?.get?.("content-length");
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    failRelease(errorCode, `${label} returned an invalid Content-Length`);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    failRelease(errorCode, `${label} returned an unsupported Content-Length`);
  }
  return length;
}

function responseContentEncoding(response, errorCode, label) {
  const value = response?.headers?.get?.("content-encoding");
  const encoding = value?.trim().toLowerCase() ?? "identity";
  if (value?.includes(",") || !supportedContentEncodings.has(encoding)) {
    failRelease(errorCode, `${label} returned an unsupported Content-Encoding`);
  }
  return encoding;
}

export async function readBoundedResponseBytes(response, options) {
  const { errorCode, label, maximumBytes } = options;
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) {
    failRelease("NETWORK_SIZE_LIMIT_INVALID", "response limit must be a positive integer");
  }
  const declaredLength = declaredResponseLength(response, errorCode, label);
  const contentEncoding = responseContentEncoding(response, errorCode, label);
  if (declaredLength !== undefined && declaredLength > maximumBytes) {
    failRelease(errorCode, `${label} response exceeds the byte limit`);
  }
  const chunks = [];
  let totalBytes = 0;
  try {
    if (response?.body?.[Symbol.asyncIterator] !== undefined) {
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > maximumBytes) {
          failRelease(errorCode, `${label} response exceeds the byte limit`);
        }
        chunks.push(bytes);
      }
    } else if (typeof response?.arrayBuffer === "function") {
      const bytes = Buffer.from(await response.arrayBuffer());
      totalBytes = bytes.length;
      if (totalBytes > maximumBytes) {
        failRelease(errorCode, `${label} response exceeds the byte limit`);
      }
      chunks.push(bytes);
    } else {
      failRelease(errorCode, `${label} response body is unreadable`);
    }
  } catch (error) {
    if (error instanceof ReleaseControlError) {
      throw error;
    }
    failRelease(errorCode, `${label} response body could not be read`, { cause: error });
  }
  if (
    contentEncoding === "identity" &&
    declaredLength !== undefined &&
    declaredLength !== totalBytes
  ) {
    failRelease(errorCode, `${label} response length differs from Content-Length`);
  }
  return Buffer.concat(chunks, totalBytes);
}
