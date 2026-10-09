/** Sole executable entry: dispatch once and translate the result into process exit. */

import { runCli } from "./index.js";

/** Command outcome; async failures are handled before this executable exits. */
const commandResult = runCli();
if (commandResult instanceof Promise) {
  commandResult
    .then((exitCode) => {
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    })
    .catch((err) => {
      process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
} else if (commandResult !== 0) {
  process.exit(commandResult);
}
