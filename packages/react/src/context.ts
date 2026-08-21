import { createContext } from "react";
import type { BoundSvgContextValue } from "./types.js";

export const BoundSvgContext = createContext<BoundSvgContextValue | null>(null);
