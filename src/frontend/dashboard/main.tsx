import { render } from "solid-js/web";
import { APP_META } from "../../shared/app-meta";
import { installDashboardRPC, subscribeTrackingStatus } from "./tauri-bridge";
import { App } from "./app";

async function bootstrap(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const app = document.getElementById("dashboard-root");
  if (!app) {
    return;
  }

  document.title = `${APP_META.displayName} Dashboard`;

  const rpc = await installDashboardRPC();
  // Keep the mount node empty so the Solid tree owns the full dashboard shell.
  app.replaceChildren();
  render(
    () => <App rpc={rpc} subscribeTrackingStatus={subscribeTrackingStatus} />,
    app,
  );
}

void bootstrap();
