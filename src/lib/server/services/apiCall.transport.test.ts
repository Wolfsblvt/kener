import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import ApiCall from "./apiCall.js";
import type { ApiMonitor } from "../types/monitor.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function httpFixture() {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/health" });
    }
    response.end("fixture");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind a TCP port");
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const monitor = (followRedirects: boolean) =>
    ({
      tag: "native-http-fixture",
      type_data: {
        url: `http://127.0.0.1:${address.port}/redirect`,
        method: "GET",
        timeout: 1000,
        observation_mode: "explicit",
        follow_redirects: followRedirects,
        eval: '(statusCode) => ({status: statusCode === 200 ? "UP" : "DOWN"})',
      },
    }) as ApiMonitor;
  return { monitor, requests, server };
}

describe("native HTTP monitor transport", () => {
  it("preserves the configured redirect behavior with the installed Axios adapter", async () => {
    const { monitor, requests } = await httpFixture();
    expect(await new ApiCall(monitor(true)).execute()).toMatchObject({ status: "UP", type: "REALTIME" });
    expect(requests).toEqual(["/redirect", "/health"]);
    requests.length = 0;
    expect(await new ApiCall(monitor(false)).execute()).toMatchObject({ status: "DOWN", type: "REALTIME" });
    expect(requests).toEqual(["/redirect"]);
  });

  it("keeps connection loss distinct from an observed HTTP failure", async () => {
    const { monitor, server } = await httpFixture();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await new ApiCall(monitor(true)).execute()).toMatchObject({
      status: "NO_DATA",
      type: "ERROR",
      error_message: "No HTTP response observed",
    });
  });
});
