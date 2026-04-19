import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export type MemoryType = "pattern" | "context" | "feedback" | "observation";

export type MemoryRecord = {
  id: number;
  type: MemoryType;
  content: string;
  metadata: Record<string, string>;
  pinned: boolean;
  createdAt: number;
};

export type MemorySearchResult = MemoryRecord & {
  score: number;
};

export type MemoryStatus = {
  enabled: boolean;
  backend: "agentkits" | "sqlite";
  total: number;
  pinned: number;
};

type AgentkitsRuntime = {
  save?: (input: { content: string; type: string; metadata?: Record<string, string> }) => Promise<unknown>;
  search?: (input: { query: string; limit: number }) => Promise<Array<{ content: string; score?: number; metadata?: Record<string, string> }>>;
};

type MemoryStoreDeps = {
  dbPath: string;
  moduleLoader?: () => Promise<unknown>;
};

function normalizeMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = String(value);
  }
  return out;
}

function parseRow(row: {
  id: number;
  type: string;
  content: string;
  metadata_json: string;
  pinned: number;
  created_at: number;
}): MemoryRecord {
  return {
    id: row.id,
    type: (row.type as MemoryType) || "context",
    content: row.content,
    metadata: normalizeMetadata(JSON.parse(row.metadata_json || "{}")),
    pinned: row.pinned === 1,
    createdAt: row.created_at,
  };
}

function scoreContent(content: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const normalized = content.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (normalized.includes(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

function toTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function toRuntimeCandidate(mod: unknown): Record<string, unknown> | null {
  if (!mod || typeof mod !== "object") {
    return null;
  }
  return mod as Record<string, unknown>;
}

function maybeWrapAgentkits(mod: unknown): AgentkitsRuntime | null {
  const candidate = toRuntimeCandidate(mod);
  if (!candidate) {
    return null;
  }

  const maybeServer =
    toRuntimeCandidate(candidate.default) ??
    toRuntimeCandidate(candidate.agentkits) ??
    candidate;

  const saveFn =
    typeof maybeServer.memory_save === "function"
      ? maybeServer.memory_save
      : typeof maybeServer.save === "function"
        ? maybeServer.save
        : null;
  const searchFn =
    typeof maybeServer.memory_search === "function"
      ? maybeServer.memory_search
      : typeof maybeServer.search === "function"
        ? maybeServer.search
        : null;

  if (!saveFn && !searchFn) {
    return null;
  }

  return {
    save:
      typeof saveFn === "function"
        ? async (input) => {
            await (saveFn as (payload: unknown) => Promise<unknown> | unknown)(input);
          }
        : undefined,
    search:
      typeof searchFn === "function"
        ? async (input) => {
            const result = await (searchFn as (payload: unknown) => Promise<unknown> | unknown)(input);
            if (!Array.isArray(result)) {
              return [];
            }
            return result
              .filter((entry): entry is { content: string; score?: number; metadata?: Record<string, string> } => {
                return Boolean(entry && typeof entry === "object" && typeof (entry as { content?: unknown }).content === "string");
              })
              .map((entry) => ({
                content: entry.content,
                score: typeof entry.score === "number" ? entry.score : 0,
                metadata: normalizeMetadata(entry.metadata),
              }));
          }
        : undefined,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;

export function createMemoryStore(deps: MemoryStoreDeps) {
  const dbPath = deps.dbPath === ":memory:" ? ":memory:" : resolve(deps.dbPath);
  const database = new Database(dbPath, { create: true });
  let runtime: AgentkitsRuntime | null = null;
  let backend: MemoryStatus["backend"] = "sqlite";

  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      content       TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      pinned        INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_entries_created_at ON memory_entries(created_at DESC)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_entries_pinned ON memory_entries(pinned, created_at DESC)
  `);

  const stmtInsert = database.prepare(
    "INSERT INTO memory_entries (type, content, metadata_json, pinned) VALUES (?, ?, ?, ?)",
  );
  const stmtSearchRows = database.prepare<
    { id: number; type: string; content: string; metadata_json: string; pinned: number; created_at: number },
    [number]
  >("SELECT id, type, content, metadata_json, pinned, created_at FROM memory_entries ORDER BY pinned DESC, created_at DESC LIMIT ?");
  const stmtListRows = database.prepare<
    { id: number; type: string; content: string; metadata_json: string; pinned: number; created_at: number },
    [number]
  >("SELECT id, type, content, metadata_json, pinned, created_at FROM memory_entries ORDER BY pinned DESC, created_at DESC LIMIT ?");
  const stmtDelete = database.prepare("DELETE FROM memory_entries WHERE id = ?");
  const stmtPin = database.prepare("UPDATE memory_entries SET pinned = ? WHERE id = ?");
  const stmtStatus = database.prepare<{ total: number; pinned: number }, []>(
    "SELECT COUNT(*) as total, SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) as pinned FROM memory_entries",
  );

  async function initialize(): Promise<void> {
    if (dbPath !== ":memory:") {
      await mkdir(dirname(dbPath), { recursive: true });
    }
    const loader = deps.moduleLoader ?? (() => import("@aitytech/agentkits-memory"));
    try {
      const moduleValue = await loader();
      const wrapped = maybeWrapAgentkits(moduleValue);
      if (wrapped) {
        runtime = wrapped;
        backend = "agentkits";
      }
    } catch {
      runtime = null;
      backend = "sqlite";
    }
  }

  async function save(input: {
    type: MemoryType;
    content: string;
    metadata?: Record<string, string>;
    pinned?: boolean;
  }): Promise<void> {
    const content = input.content.trim();
    if (!content) {
      return;
    }

    stmtInsert.run(input.type, content, JSON.stringify(input.metadata ?? {}), input.pinned ? 1 : 0);

    if (runtime?.save) {
      await runtime.save({
        content,
        type: input.type,
        metadata: input.metadata,
      });
    }
  }

  async function search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    if (runtime?.search) {
      const runtimeResults = await runtime.search({ query, limit });
      return runtimeResults.map((result, index) => ({
        id: -(index + 1),
        type: (result.metadata?.type as MemoryType) || "context",
        content: result.content,
        metadata: normalizeMetadata(result.metadata),
        pinned: false,
        createdAt: Date.now(),
        score: typeof result.score === "number" ? result.score : 0,
      }));
    }

    const queryTokens = toTokens(query);
    const rows = stmtSearchRows.all(Math.max(limit * 4, limit));
    return rows
      .map(parseRow)
      .map((entry) => ({
        ...entry,
        score: scoreContent(`${entry.type} ${entry.content} ${JSON.stringify(entry.metadata)}`, queryTokens),
      }))
      .filter((entry) => entry.score > 0 || queryTokens.length === 0)
      .sort((a, b) => b.score - a.score || Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async function recall(limit = 20): Promise<MemoryRecord[]> {
    return stmtListRows.all(limit).map(parseRow);
  }

  async function forget(id: number): Promise<void> {
    stmtDelete.run(id);
  }

  async function pin(id: number, pinned: boolean): Promise<void> {
    stmtPin.run(pinned ? 1 : 0, id);
  }

  async function getStatus(): Promise<MemoryStatus> {
    const row = stmtStatus.get() ?? { total: 0, pinned: 0 };
    return {
      enabled: true,
      backend,
      total: row.total,
      pinned: row.pinned ?? 0,
    };
  }

  return {
    initialize,
    save,
    search,
    recall,
    forget,
    pin,
    getStatus,
  };
}
