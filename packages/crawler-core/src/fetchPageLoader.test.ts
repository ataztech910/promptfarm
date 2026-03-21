import assert from "node:assert/strict";
import test from "node:test";
import { FetchPageLoader } from "./fetchPageLoader.js";

test("FetchPageLoader marks redirected /403 page as error", async () => {
  const loader = new FetchPageLoader({
    fetchFn: async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://dev.epicgames.com/documentation/403",
        headers: {
          get(name: string) {
            if (name.toLowerCase() === "content-type") {
              return "text/html";
            }
            return null;
          },
        },
        async text() {
          return "<html><head><title>Error: 403 | Epic Developer Community</title></head><body>Access not allowed</body></html>";
        },
      }) as unknown as Response,
  });

  const result = await loader.load({
    url: "https://dev.epicgames.com/documentation/en-us/fortnite/programming-with-verse-in-unreal-editor-for-fortnite",
    source: "root",
  });

  assert.equal(result.page.status, "error");
  assert.match(result.page.error ?? "", /403|Access blocked/i);
  assert.equal(result.page.url, "https://dev.epicgames.com/documentation/403");
});
