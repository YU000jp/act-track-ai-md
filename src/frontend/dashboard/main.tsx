import { render } from "solid-js/web";
import { APP_META } from "../../shared/app-meta";
import { installDashboardRPC, subscribeTrackingStatus } from "./tauri-bridge";
import { App } from "./app";

async function bootstrap(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  document.title = `${APP_META.displayName} Dashboard`;

  const rpc = await installDashboardRPC();
  render(
    () => <App rpc={rpc} subscribeTrackingStatus={subscribeTrackingStatus} />,
    app,
  );
}

void bootstrap();
