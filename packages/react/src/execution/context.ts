import { createContext } from "react";
import type { MainRenderScheduler } from "./main-render-scheduler.js";

/** Provider-owned scheduler shared by hooks that render on the main thread. */
export const MainRenderSchedulerContext = createContext<MainRenderScheduler | null>(null);
