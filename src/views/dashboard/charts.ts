function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function renderWeeklyChart(
  container: HTMLElement,
  data: Array<{ date: string; productiveMs: number }>,
): void {
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state">No weekly data yet</div>';
    return;
  }

  const max = Math.max(...data.map((point) => point.productiveMs), 1);

  container.innerHTML = `
    <h3>Weekly Focus</h3>
    <div class="bar-chart">
      ${data
        .map((point) => {
          const height = Math.max(10, Math.round((point.productiveMs / max) * 100));
          return `
            <div class="bar-col" title="${point.date}: ${formatDuration(point.productiveMs)}">
              <div class="bar-fill" style="height:${height}%"></div>
              <div class="bar-label">${point.date.slice(-5)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderMonthlyTrend(
  container: HTMLElement,
  data: Array<{ date: string; productivePct: number }>,
): void {
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state">No monthly trend yet</div>';
    return;
  }

  container.innerHTML = `
    <h3>Monthly Trend</h3>
    <ul class="trend-list">
      ${data
        .map(
          (point) => `
        <li class="trend-item">
          <span>${point.date}</span>
          <span>${Math.max(0, Math.min(100, Math.round(point.productivePct)))}%</span>
        </li>
      `,
        )
        .join("")}
    </ul>
  `;
}
