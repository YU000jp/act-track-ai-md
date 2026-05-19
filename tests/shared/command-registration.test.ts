import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd());
const mainRsPath = resolve(repoRoot, "src-tauri/src/main.rs");
const permissionsPath = resolve(repoRoot, "src-tauri/permissions/app-commands.toml");
const bridgePath = resolve(repoRoot, "src/frontend/dashboard/tauri-bridge.ts");

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function extractGenerateHandlerCommands(source: string): string[] {
  const match = source.match(/generate_handler!\s*\[(?<body>[\s\S]*?)\]/m);
  if (!match?.groups?.body) {
    throw new Error("generate_handler! block not found");
  }

  return match.groups.body
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z_][a-z0-9_]*$/i.test(entry));
}

function extractPermissionCommands(source: string): string[] {
  const match = source.match(/commands\.allow\s*=\s*\[(?<body>[\s\S]*?)\]/m);
  if (!match?.groups?.body) {
    throw new Error("commands.allow block not found");
  }

  return [...match.groups.body.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function extractBridgeCommands(source: string): string[] {
  return [...source.matchAll(/invokeDashboard\("([^"]+)"/g)].map((entry) => entry[1]);
}

describe("dashboard command registration", () => {
  it("keeps the backend handler list and ACL allow list aligned", () => {
    const mainRs = readFileSync(mainRsPath, "utf8");
    const permissions = readFileSync(permissionsPath, "utf8");

    expect(uniqueSorted(extractPermissionCommands(permissions))).toEqual(
      uniqueSorted(extractGenerateHandlerCommands(mainRs)),
    );
  });

  it("only invokes commands that are allowed by the dashboard ACL", () => {
    const bridge = readFileSync(bridgePath, "utf8");
    const permissions = readFileSync(permissionsPath, "utf8");
    const allowed = new Set(extractPermissionCommands(permissions));

    for (const command of extractBridgeCommands(bridge)) {
      expect(allowed.has(command), `Missing ACL entry for ${command}`).toBe(true);
    }
  });
});
