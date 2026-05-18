import { For } from "solid-js";
import type { DashboardToast } from "./types";

type ToastRegionProps = {
  toasts: DashboardToast[];
};

export function ToastRegion(props: ToastRegionProps) {
  return (
    <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="false">
      <For each={props.toasts}>
        {(toast) => (
          <div
            class={`toast toast-${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
            aria-live={toast.kind === "error" ? "assertive" : "polite"}
          >
            <strong>{toast.title}</strong>
            <span>{toast.message}</span>
          </div>
        )}
      </For>
    </div>
  );
}
