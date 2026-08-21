/**
 * Invoke a measurement capability after the owning Engine has completed its
 * lifecycle, availability, font-alias, and rich-text-depth checks.
 *
 * This helper is deliberately non-owning: it receives one call capability,
 * retains no WASM handle or registry, and has no disposal responsibility.
 */
export function invokeMeasurementTransport<Input, Result>(
  transport: (input: Input) => Result,
  input: Input,
): Result {
  return transport(input);
}
