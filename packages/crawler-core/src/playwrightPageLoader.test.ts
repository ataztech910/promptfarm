import assert from "node:assert/strict";
import test from "node:test";
import { PlaywrightPageLoader } from "./playwrightPageLoader.js";

test("PlaywrightPageLoader returns error page when runtime is unavailable", async () => {
  const loader = new PlaywrightPageLoader();
  const result = await loader.load({
    url: "https://example.com",
    source: "root",
  });

  assert.equal(result.page.status, "error");
  assert.ok(typeof result.page.error === "string" && result.page.error.trim().length > 0);
});
