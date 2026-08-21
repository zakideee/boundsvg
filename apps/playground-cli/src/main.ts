import "../../playground-shared/index.css";
import "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-bash";
import { getElement } from "../../playground-shared/dom.js";
import { escapeHtml } from "./code-panel";
import { initEngine } from "./engine";
import { buildUI } from "./ui";

async function main(): Promise<void> {
  const statusEl = getElement("status");
  const appEl = getElement("app");

  try {
    const engine = await initEngine();
    statusEl.style.display = "none";
    appEl.style.display = "flex";
    buildUI(engine);
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#ef4444">Engine error: ${err instanceof Error ? escapeHtml(err.message) : String(err)}</span>`;
  }
}

main();
