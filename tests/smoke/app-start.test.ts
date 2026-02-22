import { describe, expect, it } from "bun:test";

describe("app bootstrap", () => {
  it("exports startApp function", async () => {
    const mod = await import("../../src/bun/index");
    expect(typeof mod.startApp).toBe("function");
  });
});
