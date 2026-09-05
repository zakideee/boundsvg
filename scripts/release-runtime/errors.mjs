export class ReleaseControlError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ReleaseControlError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function failRelease(code, message, options) {
  throw new ReleaseControlError(code, message, options);
}

export function asReleaseControlError(error, fallbackCode) {
  if (error instanceof ReleaseControlError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ReleaseControlError(fallbackCode, message, { cause: error });
}
