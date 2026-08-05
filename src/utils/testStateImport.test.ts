import assert from "node:assert/strict";
import test from "node:test";
import { resolveDevTestStateImportText } from "./testStateImport";

test("dev checkpoint importer preserves an inline JSON payload without fetching", async () => {
  let fetchCalls = 0;
  const payload = '{"step":"simulating"}';

  const resolved = await resolveDevTestStateImportText(payload, async () => {
    fetchCalls += 1;
    throw new Error("inline payload must not fetch");
  });

  assert.equal(resolved, payload);
  assert.equal(fetchCalls, 0);
});

test("dev checkpoint importer reads only an explicit Vite /@fs/ reference", async () => {
  const requested: string[] = [];
  const resolved = await resolveDevTestStateImportText(
    "  @file:/@fs/Users/zz/Documents/new%20life/artifacts/checkpoint+08-00.json  ",
    async (resourcePath) => {
      requested.push(resourcePath);
      return { ok: true, status: 200, text: async () => '{"latestState":{}}' };
    }
  );

  assert.deepEqual(requested, ["/@fs/Users/zz/Documents/new%20life/artifacts/checkpoint+08-00.json"]);
  assert.equal(resolved, '{"latestState":{}}');
});

test("dev checkpoint importer rejects non-Vite file references before fetching", async () => {
  for (const unsafeReference of [
    "@file:https://example.com/checkpoint.json",
    "@file:file:///tmp/checkpoint.json",
    "@file:/assets/checkpoint.json"
  ]) {
    let fetchCalls = 0;
    await assert.rejects(
      resolveDevTestStateImportText(unsafeReference, async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, text: async () => "{}" };
      }),
      /仅支持 \/@fs\//u
    );
    assert.equal(fetchCalls, 0, unsafeReference);
  }
});

test("dev checkpoint importer surfaces a local-file read failure", async () => {
  await assert.rejects(
    resolveDevTestStateImportText("@file:/@fs/Users/zz/Documents/new%20life/missing.json", async () => ({
      ok: false,
      status: 404,
      text: async () => ""
    })),
    /404/u
  );
});
