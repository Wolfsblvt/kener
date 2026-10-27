import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import ApiCall from "./apiCall";

const paths: string[] = [];
const server = createServer((req, res) => {
  paths.push(req.url ?? "");
  if (req.url === "/closed") {
    req.socket.destroy();
    return;
  }
  if (req.url === "/timeout") return;
  const status = Number(req.url?.slice(1)) || 200;
  if (status === 302) res.setHeader("Location", "/never-follow");
  res.writeHead(status).end("healthy-looking-login");
});
let origin = "";
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const evaluate = `async function(statusCode, latency, body, modules) {
  if (modules.request.outcome === "transport") return {status:"NO_DATA",latency};
  if (Object.keys(modules.request).sort().join() !== "outcome,statusCode") throw new Error("unexpected metadata");
  return {status:statusCode >= 200 && statusCode < 400 ? "UP" : "DOWN",latency};
}`;
function run(route: string, evalSource = evaluate, explicit = true) {
  return new ApiCall({
    tag: "observation",
    type_data: {
      url: origin + route,
      method: "GET",
      timeout: 80,
      follow_redirects: false,
      ...(explicit ? { observation_mode: "explicit" as const } : {}),
      eval: evalSource,
    },
  }).execute();
}

describe("explicit API observation through real Axios", () => {
  it("keeps actual HTTP500 distinct from socket loss and timeout", async () => {
    expect(await run("/500")).toMatchObject({ status: "DOWN", type: "REALTIME" });
    expect(await run("/closed")).toMatchObject({ status: "NO_DATA", type: "ERROR" });
    expect(await run("/timeout")).toMatchObject({ status: "NO_DATA", type: "TIMEOUT" });
  });
  it("retains the normal HTTP response contract without following login redirects", async () => {
    expect((await run("/200")).status).toBe("UP");
    expect((await run("/302")).status).toBe("UP");
    expect((await run("/401")).status).toBe("DOWN");
    expect(paths).not.toContain("/never-follow");
  });
  it("cannot paint a missing response healthy and accepts actual NO_DATA", async () => {
    const alwaysUp = 'async function(){ return {status:"UP",latency:1} }';
    expect((await run("/closed", alwaysUp)).status).toBe("NO_DATA");
    expect(await run("/200", 'async function(){ return {status:"NO_DATA",latency:1} }')).toMatchObject({
      status: "NO_DATA",
      type: "REALTIME",
    });
    expect(await run("/200", 'async function(){ return {status:"NO_DATA",latency:1} }', false)).toMatchObject({
      status: "DOWN",
      type: "ERROR",
    });
  });
  it("contains callback diagnostics at the real evaluation boundary and leaves old callers unchanged", async () => {
    const fails = 'async function(){ throw new Error("private-callback-marker") }';
    const explicit = await run("/200", fails);
    expect(JSON.stringify(explicit)).not.toContain("private-callback-marker");
    expect(explicit).toMatchObject({
      status: "NO_DATA",
      type: "ERROR",
      error_message: "Response evaluation unavailable",
    });
    const legacy = await run("/200", fails, false);
    expect(legacy.status).toBe("DOWN");
    expect(legacy.error_message).toContain("private-callback-marker");
  });
  it("contains invalid latency values and reserves maintenance for native finite events", async () => {
    const result = await run("/200", 'async function(){return {status:"UP",latency:"private-latency-marker"}}');
    expect(JSON.stringify(result)).not.toContain("private-latency-marker");
    expect(result.status).toBe("UP");
    expect(Number.isFinite(result.latency)).toBe(true);
    expect(await run("/200", 'async function(){return {status:"MAINTENANCE",latency:1}}')).toMatchObject({
      status: "NO_DATA",
      type: "ERROR",
    });
  });
});
