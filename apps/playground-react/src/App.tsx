import { BoundSvgProvider, useBoundSvg } from "@boundsvg/react/provider";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { installPlaygroundLocatorCopy } from "../../playground-shared/locator-copy.js";
import { asset } from "./lib/asset";
import { ApiExamplesPage } from "./pages/ApiExamplesPage";
import { AnimationPage } from "./pages/animation/index";
import { HitTestPage } from "./pages/hit-test/index";
import { InteractivePage } from "./pages/InteractivePage";
import { LayoutComparePage } from "./pages/LayoutComparePage";
import { LayeredPage } from "./pages/layered/index";
import { MultiSvgEditorPage } from "./pages/MultiSvgEditorPage";
import { PlaygroundPage } from "./pages/playground/index";
import { ShapesPage } from "./pages/shapes/index";
import { TemplatesPage } from "./pages/templates/index";
import { TextEffectsPage } from "./pages/text-effects/index";
import { TextFlowPage } from "./pages/text-flow/index";
import { TransformPage } from "./pages/transform/index";
import { WorkerAsyncPage } from "./pages/WorkerAsyncPage";
import {
  config,
  DEFAULT_ROUTE_KEY,
  ROUTE_BY_HASH,
  ROUTE_GROUP_BY_ROUTE,
  ROUTE_GROUPS,
  ROUTES,
  type RouteKey,
} from "./types";

export function App() {
  return (
    <BoundSvgProvider config={config} fallback={<LoadingScreen />}>
      <ExampleSpa />
    </BoundSvgProvider>
  );
}

function LoadingScreen() {
  return (
    <div className="screen-center">
      <p>Loading WASM &amp; fonts&hellip;</p>
    </div>
  );
}

function ExampleSpa() {
  const route = useHashRoute();

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }
    return installPlaygroundLocatorCopy({ playground: "playground-react" });
  }, []);

  return (
    <div className="example-shell">
      <header className="example-header">
        <div className="header-top-row">
          <div className="brand-copy">
            <div className="brand-lockup">
              <img
                className="brand-logo"
                src={asset("/logo/boundsvg-logo-horizontal-violet-muted.svg")}
                alt=""
                aria-hidden="true"
              />
              <h1 className="brand">React</h1>
            </div>
            <span className="brand-sub">Component builder with live preview</span>
          </div>
          <div className="header-meta">
            <a
              className="github-link"
              href="https://github.com/zakideee/boundsvg"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 16 16"
                fill="currentColor"
                role="img"
                aria-label="GitHub"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
            <StatusStrip />
          </div>
        </div>
        <RouteNav route={route} />
      </header>

      <main className="example-main">
        {route === "playground" && <PlaygroundPage />}
        {route === "templates" && <TemplatesPage />}
        {route === "shapes" && <ShapesPage />}
        {route === "text-flow" && <TextFlowPage />}
        {route === "text-effects" && <TextEffectsPage />}
        {route === "api" && <ApiExamplesPage />}
        {route === "compare" && <LayoutComparePage />}
        {route === "editor" && <MultiSvgEditorPage />}
        {route === "interactive" && <InteractivePage />}
        {route === "hit-test" && <HitTestPage />}
        {route === "worker" && <WorkerAsyncPage />}
        {route === "layered" && <LayeredPage />}
        {route === "animation" && <AnimationPage />}
        {route === "transform" && <TransformPage />}
      </main>
    </div>
  );
}

function RouteNav({ route }: { route: RouteKey }) {
  const activeGroup = ROUTE_GROUP_BY_ROUTE.get(route) ?? ROUTE_GROUPS[0];
  // Remember the last visited page per category so switching categories
  // returns to where the user left off.
  const lastVisitedRef = useRef(new Map<string, string>());
  if (activeGroup) {
    const currentDef = activeGroup.routes.find((r) => r.key === route);
    if (currentDef) {
      lastVisitedRef.current.set(activeGroup.key, currentDef.hash);
    }
  }

  return (
    <nav className="route-nav route-nav-grouped" aria-label="Pages">
      <div className="route-nav-row route-nav-categories">
        {ROUTE_GROUPS.map((group) => {
          const target = lastVisitedRef.current.get(group.key) ?? group.routes[0]?.hash ?? "#/";
          return (
            <a
              key={group.key}
              href={target}
              className={`route-link route-category ${group === activeGroup ? "active" : ""}`}
              data-playground-locator-level="category"
              data-playground-locator-segment={`Category: ${group.label} [${group.key}]`}
            >
              {group.label}
            </a>
          );
        })}
      </div>
      <div className="route-nav-row route-nav-pages">
        {(activeGroup?.routes ?? []).map((r) => (
          <a
            key={r.key}
            href={r.hash}
            className={`route-link ${route === r.key ? "active" : ""}`}
            data-playground-locator-level="page"
            data-playground-locator-segment={`Page: ${r.label} [${r.key}]`}
          >
            {r.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function StatusStrip() {
  const { status, error } = useBoundSvg();
  const text =
    status === "ready"
      ? "Engine ready"
      : status === "loading" || status === "idle"
        ? "Engine loading\u2026"
        : `Engine error: ${error?.message ?? "Unknown error"}`;

  return (
    <div className="status-strip" role={status === "error" ? "alert" : "status"}>
      <span className={`status-dot ${status}`} />
      <span>{text}</span>
    </div>
  );
}

function useHashRoute(): RouteKey {
  useEffect(() => {
    if (!window.location.hash) {
      const defaultRoute = ROUTES.find((r) => r.key === DEFAULT_ROUTE_KEY);
      if (defaultRoute) {
        window.location.hash = defaultRoute.hash;
      }
    }
  }, []);

  return useSyncExternalStore(
    subscribeToHashRoute,
    getHashRouteSnapshot,
    getServerHashRouteSnapshot,
  );
}

function subscribeToHashRoute(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

function getHashRouteSnapshot(): RouteKey {
  return resolveRouteHash(window.location.hash);
}

function getServerHashRouteSnapshot(): RouteKey {
  return DEFAULT_ROUTE_KEY;
}

function resolveRouteHash(hash: string): RouteKey {
  return ROUTE_BY_HASH.get(hash) ?? DEFAULT_ROUTE_KEY;
}
