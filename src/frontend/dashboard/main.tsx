import { render } from "solid-js/web";
import { APP_META } from "../../shared/app-meta";
import {
  installDashboardRPC,
  subscribeActivityLogUpdates,
  subscribeBrowserHistoryUpdates,
  subscribeTrackingStatus,
} from "./tauri-bridge";
import { App } from "./app";
import "./style.css";

const faviconUrl = new URL("../assets/icon.png", import.meta.url).href;
let disposeApp: (() => void) | undefined;
// HMR can re-enter while the async bootstrap is still pending.
let bootstrapGeneration = 0;

async function bootstrap(): Promise<void> {
  const currentGeneration = ++bootstrapGeneration;

  if (typeof document === "undefined") {
    return;
  }

  const app = document.getElementById("dashboard-root");
  if (!app) {
    return;
  }

  document.title = `${APP_META.displayName} Dashboard`;
  const faviconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']") ?? document.createElement("link");
  faviconLink.rel = "icon";
  faviconLink.type = "image/png";
  faviconLink.href = faviconUrl;
  if (!faviconLink.isConnected) {
    document.head.append(faviconLink);
  }

  const rpc = await installDashboardRPC();
  if (currentGeneration !== bootstrapGeneration) {
    return;
  }

  // Keep the mount node empty so the Solid tree owns the full dashboard shell.
  app.replaceChildren();
  disposeApp?.();
  disposeApp = render(
    () => (
      <App
        rpc={rpc}
        subscribeTrackingStatus={subscribeTrackingStatus}
        subscribeActivityLogUpdates={subscribeActivityLogUpdates}
        subscribeBrowserHistoryUpdates={subscribeBrowserHistoryUpdates}
      />
    ),
    app,
  );
}

void bootstrap();

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    bootstrapGeneration += 1;
    disposeApp?.();
    disposeApp = undefined;
    void bootstrap();
  });

  import.meta.hot.dispose(() => {
    bootstrapGeneration += 1;
    disposeApp?.();
    disposeApp = undefined;
  });
}
