// @bun
var __require = import.meta.require;

// src/bun/classifier.ts
function createClassifier(deps) {
  return {
    async classify(processName, windowTitle) {
      const truncatedTitle = windowTitle.slice(0, 200);
      const cached = deps.datastores.getCachedClassification(processName, truncatedTitle);
      if (cached) {
        return {
          category: cached.category,
          label: cached.label,
          confidence: cached.confidence,
          source: "cache"
        };
      }
      try {
        const result = await deps.geminiClassify({
          apiKey: deps.apiKey,
          processName,
          windowTitle
        });
        deps.datastores.upsertCachedClassification(processName, truncatedTitle, result.category, result.label, result.confidence);
        return {
          category: result.category,
          label: result.label,
          confidence: result.confidence,
          source: "gemini"
        };
      } catch {
        return {
          category: "unknown",
          label: "Uncategorized",
          confidence: 0,
          source: "fallback"
        };
      }
    }
  };
}

// src/bun/db.ts
import { Database } from "bun:sqlite";
function dayBounds(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const start = d.getTime();
  const end = start + 86400000;
  return { start, end };
}
function createDatastores(cachePath, activityPath) {
  const cache = new Database(cachePath);
  const activity = new Database(activityPath);
  cache.exec("PRAGMA journal_mode=WAL");
  activity.exec("PRAGMA journal_mode=WAL");
  cache.exec(`
    CREATE TABLE IF NOT EXISTS classification_cache (
      process_name TEXT NOT NULL,
      window_title TEXT NOT NULL,
      category     TEXT NOT NULL,
      label        TEXT NOT NULL,
      confidence   REAL DEFAULT 1.0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (process_name, window_title)
    )
  `);
  activity.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp    INTEGER NOT NULL,
      process_name TEXT NOT NULL,
      window_title TEXT NOT NULL,
      category     TEXT NOT NULL,
      label        TEXT NOT NULL,
      duration_ms  INTEGER DEFAULT 0
    )
  `);
  activity.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp)
  `);
  activity.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_process_ts ON activity_log(process_name, timestamp)
  `);
  activity.exec(`
    CREATE TABLE IF NOT EXISTS daily_summary (
      date              TEXT PRIMARY KEY,
      total_tracked_ms  INTEGER,
      productive_ms     INTEGER,
      distraction_ms    INTEGER,
      neutral_ms        INTEGER,
      top_apps          TEXT,
      ai_summary        TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);
  activity.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  const stmtGetCache = cache.prepare("SELECT category, label, confidence FROM classification_cache WHERE process_name = ? AND window_title = ?");
  const stmtUpsertCache = cache.prepare(`INSERT INTO classification_cache (process_name, window_title, category, label, confidence)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(process_name, window_title) DO UPDATE SET category=excluded.category, label=excluded.label, confidence=excluded.confidence`);
  const stmtCacheCount = cache.prepare("SELECT count(*) as cnt FROM classification_cache");
  const stmtInsertActivity = activity.prepare("INSERT INTO activity_log (timestamp, process_name, window_title, category, label) VALUES (?, ?, ?, ?, ?)");
  const stmtSetDuration = activity.prepare("UPDATE activity_log SET duration_ms = ? WHERE id = ?");
  const stmtActivityRange = activity.prepare("SELECT * FROM activity_log WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp");
  const stmtDayStats = activity.prepare("SELECT category, SUM(duration_ms) as total FROM activity_log WHERE timestamp >= ? AND timestamp < ? GROUP BY category");
  const stmtTopApps = activity.prepare("SELECT process_name, SUM(duration_ms) as total, category FROM activity_log WHERE timestamp >= ? AND timestamp < ? GROUP BY process_name ORDER BY total DESC LIMIT ?");
  const stmtGetSetting = activity.prepare("SELECT value FROM settings WHERE key = ?");
  const stmtSetSetting = activity.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const stmtSaveSummary = activity.prepare(`INSERT INTO daily_summary (date, total_tracked_ms, productive_ms, distraction_ms, neutral_ms, top_apps, ai_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET total_tracked_ms=excluded.total_tracked_ms, productive_ms=excluded.productive_ms, distraction_ms=excluded.distraction_ms, neutral_ms=excluded.neutral_ms, top_apps=excluded.top_apps, ai_summary=excluded.ai_summary`);
  const stmtGetSummary = activity.prepare("SELECT * FROM daily_summary WHERE date = ?");
  return {
    cache,
    activity,
    getCachedClassification(processName, windowTitle) {
      const row = stmtGetCache.get(processName, windowTitle);
      return row ?? null;
    },
    upsertCachedClassification(processName, windowTitle, category, label, confidence) {
      stmtUpsertCache.run(processName, windowTitle, category, label, confidence);
    },
    getCacheCount() {
      return stmtCacheCount.get().cnt;
    },
    clearCache() {
      cache.exec("DELETE FROM classification_cache");
    },
    insertActivitySample(sample) {
      stmtInsertActivity.run(sample.timestamp, sample.processName, sample.windowTitle, sample.category, sample.label);
      return activity.query("SELECT last_insert_rowid() as id").get().id;
    },
    setActivityDuration(id, durationMs) {
      stmtSetDuration.run(durationMs, id);
    },
    getActivityRange(fromMs, toMs) {
      const rows = stmtActivityRange.all(fromMs, toMs);
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        processName: r.process_name,
        windowTitle: r.window_title,
        category: r.category,
        label: r.label,
        durationMs: r.duration_ms
      }));
    },
    getStatsForDay(dateStr) {
      const { start, end } = dayBounds(dateStr);
      const rows = stmtDayStats.all(start, end);
      const result = { totalTrackedMs: 0, productiveMs: 0, distractionMs: 0, neutralMs: 0 };
      for (const row of rows) {
        const ms = row.total || 0;
        result.totalTrackedMs += ms;
        if (row.category === "productive")
          result.productiveMs = ms;
        else if (row.category === "distraction")
          result.distractionMs = ms;
        else if (row.category === "neutral")
          result.neutralMs = ms;
      }
      return result;
    },
    getTopAppsForDay(dateStr, limit) {
      const { start, end } = dayBounds(dateStr);
      return stmtTopApps.all(start, end, limit).map((r) => ({
        processName: r.process_name,
        durationMs: r.total,
        category: r.category
      }));
    },
    getSetting(key) {
      const row = stmtGetSetting.get(key);
      return row ? row.value : null;
    },
    setSetting(key, value) {
      stmtSetSetting.run(key, value);
    },
    saveDailySummary(summary) {
      stmtSaveSummary.run(summary.date, summary.totalTrackedMs, summary.productiveMs, summary.distractionMs, summary.neutralMs, JSON.stringify(summary.topApps), summary.aiSummary);
    },
    getDailySummary(dateStr) {
      const row = stmtGetSummary.get(dateStr);
      if (!row)
        return null;
      return {
        date: row.date,
        totalTrackedMs: row.total_tracked_ms,
        productiveMs: row.productive_ms,
        distractionMs: row.distraction_ms,
        neutralMs: row.neutral_ms,
        topApps: JSON.parse(row.top_apps || "[]"),
        aiSummary: row.ai_summary
      };
    }
  };
}

// src/bun/gemini.ts
var VALID_CATEGORIES = ["productive", "distraction", "neutral"];
function buildClassificationPrompt(processName, windowTitle) {
  const system = "You are a productivity classifier. Given a process name and window title, classify the activity. " + 'Respond with JSON only: { "category": "productive" | "distraction" | "neutral", "label": string, "confidence": number }';
  const user = `Process: ${processName}
Window Title: ${windowTitle}`;
  return { system, user };
}
function parseClassificationResponse(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON response: ${raw}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Response is not an object");
  }
  const obj = parsed;
  const category = obj.category;
  if (typeof category !== "string" || !VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${String(category)}`);
  }
  const label = obj.label;
  if (typeof label !== "string" || label.trim() === "") {
    throw new Error("Missing or empty label");
  }
  const confidence = typeof obj.confidence === "number" ? obj.confidence : 1;
  return {
    category,
    label,
    confidence
  };
}
async function classifyWithGemini(opts) {
  const { apiKey, processName, windowTitle, fetchImpl } = opts;
  const fetcher = fetchImpl ?? fetch;
  const { system, user } = buildClassificationPrompt(processName, windowTitle);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: user }] }],
    systemInstruction: { parts: [{ text: system }] }
  };
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("No candidates in Gemini response");
  }
  const text = data.candidates[0].content.parts[0].text;
  return parseClassificationResponse(text);
}

// src/bun/notifier.ts
function createNotifierPolicy(config) {
  let distractionStartedAt = null;
  let lastNotifiedAt = null;
  return {
    onSample(sample) {
      const now = config.now();
      if (sample.category !== "distraction") {
        distractionStartedAt = null;
        return;
      }
      if (distractionStartedAt === null) {
        distractionStartedAt = now;
      }
      const elapsed = now - distractionStartedAt;
      if (elapsed < config.graceMs)
        return;
      if (lastNotifiedAt !== null && now - lastNotifiedAt < config.cooldownMs)
        return;
      config.notify("\uD83C\uDFAF Kembali Fokus!", `Kamu sudah di ${sample.processName} terlalu lama. Waktunya balik kerja!`);
      lastNotifiedAt = now;
    }
  };
}

// src/bun/tracker.ts
var MAX_TITLE_LENGTH = 200;
function normalizeSnapshot(raw, selfProcessName) {
  if (!raw)
    return null;
  const processPath = raw.processPath.trim();
  const windowTitle = raw.windowTitle.trim();
  if (!processPath && !windowTitle)
    return null;
  const separator = processPath.includes("\\") ? "\\" : "/";
  const segments = processPath.split(separator);
  const processName = (segments[segments.length - 1] || "").toLowerCase();
  if (!processName)
    return null;
  if (selfProcessName && processName === selfProcessName.toLowerCase()) {
    return null;
  }
  return {
    processName,
    windowTitle: windowTitle.slice(0, MAX_TITLE_LENGTH)
  };
}
function isIdle(idleMs, timeoutMs) {
  return idleMs >= timeoutMs;
}
function createWindowsFFIBindings() {
  try {
    const { dlopen, FFIType, ptr } = __require("bun:ffi");
    const user32 = dlopen("user32.dll", {
      GetForegroundWindow: { args: [], returns: FFIType.ptr },
      GetWindowTextW: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32
      },
      GetWindowThreadProcessId: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.u32
      },
      GetLastInputInfo: {
        args: [FFIType.ptr],
        returns: FFIType.bool
      }
    });
    const kernel32 = dlopen("kernel32.dll", {
      OpenProcess: {
        args: [FFIType.u32, FFIType.bool, FFIType.u32],
        returns: FFIType.ptr
      },
      CloseHandle: {
        args: [FFIType.ptr],
        returns: FFIType.bool
      },
      GetTickCount: {
        args: [],
        returns: FFIType.u32
      }
    });
    const psapi = dlopen("psapi.dll", {
      GetModuleFileNameExW: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
        returns: FFIType.u32
      }
    });
    const PROCESS_QUERY_INFORMATION = 1024;
    const PROCESS_VM_READ = 16;
    return {
      getForegroundWindow() {
        const hwnd = user32.symbols.GetForegroundWindow();
        if (!hwnd)
          return null;
        const titleBuf = new Uint16Array(256);
        const titleLen = user32.symbols.GetWindowTextW(hwnd, ptr(titleBuf), 256);
        const windowTitle = String.fromCharCode(...titleBuf.slice(0, titleLen));
        const pidBuf = new Uint32Array(1);
        user32.symbols.GetWindowThreadProcessId(hwnd, ptr(pidBuf));
        const pid = pidBuf[0];
        if (!pid)
          return normalizeSnapshot({ processPath: "", windowTitle });
        const hProcess = kernel32.symbols.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        if (!hProcess)
          return normalizeSnapshot({ processPath: "", windowTitle });
        const pathBuf = new Uint16Array(260);
        const pathLen = psapi.symbols.GetModuleFileNameExW(hProcess, null, ptr(pathBuf), 260);
        kernel32.symbols.CloseHandle(hProcess);
        const processPath = String.fromCharCode(...pathBuf.slice(0, pathLen));
        return normalizeSnapshot({ processPath, windowTitle });
      },
      getIdleMs() {
        const buf = new Uint32Array(2);
        buf[0] = 8;
        const ok = user32.symbols.GetLastInputInfo(ptr(buf));
        if (!ok)
          return 0;
        const lastInput = buf[1];
        const tickCount = kernel32.symbols.GetTickCount();
        return tickCount - lastInput;
      }
    };
  } catch {
    return {
      getForegroundWindow: () => null,
      getIdleMs: () => 0
    };
  }
}

// src/bun/index.ts
function createApp(deps) {
  const classifier = createClassifier({
    datastores: deps.datastores,
    geminiClassify: deps.geminiClassify ?? classifyWithGemini,
    apiKey: deps.apiKey
  });
  const notifier = createNotifierPolicy({
    notify: deps.notify,
    now: deps.now,
    graceMs: deps.graceMs,
    cooldownMs: deps.cooldownMs
  });
  let previousSample = null;
  let intervalId = null;
  async function tick() {
    const snapshot = deps.tracker.getForegroundWindow();
    if (!snapshot) {
      return;
    }
    if (isIdle(deps.tracker.getIdleMs(), deps.idleTimeoutMs)) {
      return;
    }
    const classification = await classifier.classify(snapshot.processName, snapshot.windowTitle);
    const timestamp = deps.now();
    if (previousSample && (previousSample.processName !== snapshot.processName || previousSample.windowTitle !== snapshot.windowTitle)) {
      const durationMs = Math.max(0, timestamp - previousSample.timestamp);
      deps.datastores.setActivityDuration(previousSample.id, durationMs);
    }
    const id = deps.datastores.insertActivitySample({
      timestamp,
      processName: snapshot.processName,
      windowTitle: snapshot.windowTitle,
      category: classification.category,
      label: classification.label
    });
    previousSample = {
      id,
      timestamp,
      processName: snapshot.processName,
      windowTitle: snapshot.windowTitle
    };
    notifier.onSample({
      category: classification.category,
      processName: snapshot.processName,
      windowTitle: snapshot.windowTitle
    });
  }
  function start() {
    if (intervalId) {
      return;
    }
    intervalId = setInterval(() => {
      tick();
    }, deps.pollIntervalMs);
  }
  function stop() {
    if (!intervalId) {
      return;
    }
    clearInterval(intervalId);
    intervalId = null;
  }
  function isRunning() {
    return intervalId !== null;
  }
  return {
    start,
    stop,
    isRunning,
    tick
  };
}
function parseNumberSetting(value, fallback) {
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
function loadElectrobun() {
  try {
    const maybeGlobal = globalThis;
    if (!maybeGlobal.require) {
      return null;
    }
    const mod = maybeGlobal.require("electrobun");
    if (typeof mod !== "object" || mod === null) {
      return null;
    }
    return mod;
  } catch {
    return null;
  }
}
function startApp() {
  const datastores = createDatastores("act-track-cache.db", "act-track-activity.db");
  const apiKeyFromSettings = datastores.getSetting("geminiApiKey");
  const apiKey = apiKeyFromSettings || process.env.GEMINI_API_KEY || "";
  const pollIntervalMs = parseNumberSetting(datastores.getSetting("pollIntervalMs"), 3000);
  const idleTimeoutMs = parseNumberSetting(datastores.getSetting("idleTimeoutMs"), 300000);
  const graceMs = parseNumberSetting(datastores.getSetting("gracePeriodMs"), 30000);
  const cooldownMs = parseNumberSetting(datastores.getSetting("notificationCooldownMs"), 300000);
  const electrobun = loadElectrobun();
  const app = createApp({
    tracker: createWindowsFFIBindings(),
    datastores,
    apiKey,
    pollIntervalMs,
    idleTimeoutMs,
    graceMs,
    cooldownMs,
    notify: (title, body) => {
      if (electrobun?.Utils?.showNotification) {
        electrobun.Utils.showNotification({ title, body });
        return;
      }
      console.log(`[notification] ${title}: ${body}`);
    },
    now: () => Date.now(),
    selfProcessName: process.title
  });
  app.start();
}
export {
  startApp,
  createApp
};
