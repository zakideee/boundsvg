// ---------------------------------------------------------------------------
// boundsvg — executable bin entry.
//
// This file exists so the published bin ALWAYS runs the CLI. The previous
// bin pointed at index.js, whose "am I being executed directly?" check
// compared process.argv[1] against import.meta.url — but tsup code-splitting
// moved that code into a shared chunk, so the comparison never matched and
// the distributed CLI exited 0 without doing anything.
// ---------------------------------------------------------------------------

import { runCli } from "./index.js";

const result = runCli();
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
