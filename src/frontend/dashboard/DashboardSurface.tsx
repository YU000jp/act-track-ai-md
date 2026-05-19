import type { JSX } from "solid-js";

type DashboardSurfaceProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: JSX.Element;
  class?: string;
  children: JSX.Element;
};

export function DashboardSurface(props: DashboardSurfaceProps) {
  return (
    <section class={`surface ${props.class ?? ""}`.trim()}>
      <header class="surface-header">
        <div class="surface-copy">
          {props.eyebrow ? <p class="surface-eyebrow">{props.eyebrow}</p> : null}
          <h2 class="surface-title">{props.title}</h2>
          {props.description ? <p class="surface-description">{props.description}</p> : null}
        </div>
        {props.actions ? <div class="surface-actions">{props.actions}</div> : null}
      </header>
      <div class="surface-body">{props.children}</div>
    </section>
  );
}
