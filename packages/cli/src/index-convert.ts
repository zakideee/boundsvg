// ---------------------------------------------------------------------------
// boundsvg-convert — backward-compatible entry point
// Inserts "convert" subcommand and delegates to the main CLI.
// ---------------------------------------------------------------------------

import { runCli } from "./index.js";

const argv = [...process.argv];
// Insert "convert" after node + script path
argv.splice(2, 0, "convert");

const result = runCli({ argv });
if (result instanceof Promise) {
  result
    .then((exitCode) => {
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    })
    .catch((err) => {
      process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
} else if (result !== 0) {
  process.exit(result);
}
