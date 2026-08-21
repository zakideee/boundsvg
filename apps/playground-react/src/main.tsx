import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getElement } from "../../playground-shared/dom.js";
import { App } from "./App.js";
import "./app.css";

createRoot(getElement("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
