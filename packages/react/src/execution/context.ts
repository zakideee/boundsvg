import { createContext } from "react";
import type { MainRenderScheduler } from "./main-render-scheduler.js";

export const MainRenderSchedulerContext = createContext<MainRenderScheduler | null>(null);
