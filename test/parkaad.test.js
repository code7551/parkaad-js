import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { Parkaad, ParkaadError, VERSION } from "../src/index.js";

// A stand-in for the partner API: records what it was asked, answers what each test sets.
const KEY = `pk_${"A".repeat(20)}.${"s".repeat(43)}`;
let server;
let baseUrl;
let calls;
let reply;

before(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
    const { status = 200, json, text, delayMs = 0, type = "application/json" } = reply(calls.at(-1)) ?? {};
    setTimeout(() => {
      res.writeHead(status, { "content-type": type });
      res.end(json !== undefined ? JSON.stringify(json) : (text ?? ""));
    }, delayMs);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  calls = [];
  reply = () => ({ json: {} });
});

const station = (port) => ({
  station: { name: `Radio ${port}` },
  server: { type: "icecast", host: "stream.example.com", port, mount: "/live", password: "pw" },
});
const parkaad = (options = {}) => new Parkaad({ apiKey: KEY, baseUrl, ...options });

describe("requests", () => {
  test("sends the key, JSON, and who's calling", async () => {
    reply = () => ({ status: 201, json: { id: "s1", url: "https://parkaad.com/live/AbCdEfGhJk12" } });
    await parkaad().stations.create(station(8000));
    const [call] = calls;
    assert.equal(call.method, "POST");
    assert.equal(call.url, "/api/partner/v1/stations");
    assert.equal(call.headers.authorization, `Bearer ${KEY}`);
    assert.equal(call.headers["content-type"], "application/json");
    assert.equal(call.headers["user-agent"], `parkaad-node/${VERSION}`);
    assert.deepEqual(call.body, station(8000));
  });

  test("a trailing slash on baseUrl is fine", async () => {
    await parkaad({ baseUrl: `${baseUrl}/` }).stations.list();
    assert.equal(calls[0].url, "/api/partner/v1/stations");
  });

  test("ids are escaped into the path", async () => {
    await parkaad().stations.get("a/b?c");
    assert.equal(calls[0].url, "/api/partner/v1/stations/a%2Fb%3Fc");
  });
});

describe("stations", () => {
  test("create: a new station (201) → created", async () => {
    reply = () => ({ status: 201, json: { id: "s1", url: "u" } });
    assert.deepEqual(await parkaad().stations.create(station(8000)), { id: "s1", url: "u", created: true });
  });

  test("create: a server you already have (200) → updated, not created", async () => {
    reply = () => ({ status: 200, json: { id: "s1", url: "u" } });
    assert.equal((await parkaad().stations.create(station(8000))).created, false);
  });

  test("list and get", async () => {
    reply = (call) => (call.url.endsWith("/stations") ? { json: { stations: [{ id: "s1" }], limit: 50 } } : { json: { id: "s1" } });
    assert.deepEqual(await parkaad().stations.list(), { stations: [{ id: "s1" }], limit: 50 });
    assert.deepEqual(await parkaad().stations.get("s1"), { id: "s1" });
  });

  test("delete (204)", async () => {
    reply = () => ({ status: 204 });
    assert.equal(await parkaad().stations.delete("s1"), undefined);
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].url, "/api/partner/v1/stations/s1");
  });

  test("renewLink: delete, then create again", async () => {
    reply = (call) => (call.method === "DELETE" ? { status: 204 } : { status: 201, json: { id: "s2", url: "new" } });
    const renewed = await parkaad().stations.renewLink("s1", station(8000));
    assert.deepEqual(calls.map((c) => c.method), ["DELETE", "POST"]);
    assert.deepEqual(renewed, { id: "s2", url: "new", created: true });
  });

  test("renewLink: a station already gone is just made again", async () => {
    reply = (call) =>
      call.method === "DELETE" ? { status: 404, json: { error: "not_found", message: "No such station" } } : { status: 201, json: { id: "s2" } };
    assert.equal((await parkaad().stations.renewLink("s1", station(8000))).id, "s2");
  });

  test("renewLink: other errors stop it before anything is made", async () => {
    reply = () => ({ status: 401, json: { error: "unauthorized", message: "nope" } });
    await assert.rejects(parkaad().stations.renewLink("s1", station(8000)), { code: "unauthorized" });
    assert.deepEqual(calls.map((c) => c.method), ["DELETE"]);
  });
});

describe("errors", () => {
  test("the API's error: its code, message and status", async () => {
    reply = () => ({ status: 409, json: { error: "station_limit", message: "The partner has all 50 of its stations" } });
    await assert.rejects(parkaad().stations.create(station(8000)), (err) => {
      assert.ok(err instanceof ParkaadError);
      assert.equal(err.code, "station_limit");
      assert.equal(err.status, 409);
      assert.equal(err.message, "The partner has all 50 of its stations");
      return true;
    });
  });

  test("an HTML page instead of the API (a proxy's challenge): blocked", async () => {
    reply = () => ({ status: 403, text: "<html>Just a moment…</html>", type: "text/html" });
    await assert.rejects(parkaad().stations.list(), { code: "blocked", status: 403 });
  });

  test("a 200 that isn't JSON: invalid_response", async () => {
    reply = () => ({ status: 200, text: "ok", type: "text/plain" });
    await assert.rejects(parkaad().stations.list(), { code: "invalid_response" });
  });

  test("no answer in time: timeout", async () => {
    reply = () => ({ delayMs: 500, json: {} });
    await assert.rejects(parkaad({ timeoutMs: 100 }).stations.list(), { code: "timeout" });
  });

  test("nobody there: network", async () => {
    await assert.rejects(parkaad({ baseUrl: "http://127.0.0.1:1" }).stations.list(), { code: "network" });
  });
});

describe("setup", () => {
  test("the key must look like one", () => {
    for (const apiKey of ["", "pk_short.x", "hello", `${KEY}x`]) {
      assert.throws(() => new Parkaad({ apiKey }), { code: "invalid_api_key" });
    }
  });

  test("the key defaults to PARKAAD_API_KEY", async () => {
    process.env.PARKAAD_API_KEY = KEY;
    try {
      await new Parkaad({ baseUrl }).stations.list();
      assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
    } finally {
      delete process.env.PARKAAD_API_KEY;
    }
  });

  test("refuses to run in a browser (unless told to)", () => {
    globalThis.window = {};
    globalThis.document = {};
    try {
      assert.throws(() => new Parkaad({ apiKey: KEY }), { code: "browser" });
      assert.ok(new Parkaad({ apiKey: KEY, dangerouslyAllowBrowser: true }));
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  });
});
