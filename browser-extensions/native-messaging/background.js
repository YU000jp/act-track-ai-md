const api = globalThis.browser ?? globalThis.chrome;
const HOST_NAME = "com.irdan.act_track_ai_md";
const PROFILE_NAME = "native-messaging";

let port = null;
let reconnectTimer = null;

function detectBrowserName() {
  const extensionUrl = api.runtime.getURL("");
  if (extensionUrl.startsWith("moz-extension://")) {
    return "firefox";
  }
  if (extensionUrl.startsWith("chrome-extension://")) {
    return "chrome";
  }
  return "browser";
}

function connectNativeHost() {
  try {
    port = api.runtime.connectNative(HOST_NAME);
    port.onDisconnect.addListener(() => {
      port = null;
      scheduleReconnect();
    });
  } catch {
    port = null;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNativeHost();
  }, 1000);
}

function queryActiveTab() {
  if (api.tabs.query.length <= 1) {
    return api.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs?.[0] ?? null);
  }

  return new Promise((resolve) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0] ?? null);
    });
  });
}

function postVisit(tab) {
  if (!port) {
    connectNativeHost();
    return;
  }

  const now = Date.now();
  const visitedAt = typeof tab.lastAccessed === "number" ? tab.lastAccessed : now;
  port.postMessage({
    browser: detectBrowserName(),
    profile: PROFILE_NAME,
    url: tab.url || "",
    title: tab.title || "",
    visitedAt,
    lastVisitAt: visitedAt,
    source: "native-messaging",
  });
}

async function captureActiveTab() {
  const tab = await queryActiveTab();
  if (!tab || !tab.url) {
    return;
  }

  postVisit(tab);
}

api.tabs.onActivated.addListener(() => {
  void captureActiveTab();
});

api.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.active) {
    void captureActiveTab();
  }
});

api.windows.onFocusChanged.addListener(() => {
  void captureActiveTab();
});

connectNativeHost();
