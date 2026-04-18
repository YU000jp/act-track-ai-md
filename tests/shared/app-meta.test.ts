import { describe, expect, it } from "bun:test";
import { APP_META } from "../../src/shared/app-meta";

describe("app metadata", () => {
  it("defines canonical temporary app naming", () => {
    expect(APP_META.displayName).toBe("ActTrack AI MD");
    expect(APP_META.packageName).toBe("act-track-ai-md");
    expect(APP_META.identifier).toBe("com.irdan.acttrackaimd");
    expect(APP_META.isProvisionalName).toBe(true);
  });
});
