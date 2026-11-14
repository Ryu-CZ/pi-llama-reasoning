import assert from "node:assert/strict";
import test from "node:test";
import { fetchLoadedModelProps } from "../extensions/lib/discovery.ts";
import { model, props } from "./helpers/model.mjs";

test("checks router status before requesting model props and preserves URL prefix/auth", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1
      ? { data: [{ id: "a/b + c", status: { value: "loaded" } }] }
      : props);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await fetchLoadedModelProps("http://localhost:8080/proxy/v1/", "a/b + c", { Authorization: "Bearer test" }, signal), props);
  assert.equal(calls[0].url, "http://localhost:8080/proxy/models");
  const url = new URL(calls[1].url);
  assert.equal(url.pathname, "/proxy/props");
  assert.equal(url.searchParams.get("model"), "a/b + c");
  assert.equal(calls[1].init.signal, signal);
  assert.deepEqual(calls[1].init.headers, { Authorization: "Bearer test" });
  assert.equal(calls[1].init.redirect, "error");
});

for (const status of ["sleeping", "unloaded", "loading", "failed", undefined]) {
  test(`does not query props for ${status} models`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ data: [{ id: "qwen", status: { value: status } }] });
    });
    assert.equal(await fetchLoadedModelProps(model().baseUrl, "qwen", {}, new AbortController().signal), undefined);
    assert.equal(calls, 1);
  });
}

test("HTTP errors are rejected without including credentials or response bodies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("secret", { status: 401 }));
  await assert.rejects(fetchLoadedModelProps(model().baseUrl, "qwen", {}, new AbortController().signal), {
    message: "llama.cpp discovery returned HTTP 401",
  });
});
