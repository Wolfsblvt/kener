import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Socket } from "node:net";
import getSMTPTransport from "./smtps.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function smtpFixture() {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 local fixture\r\n");
    let buffer = "";
    let message: string[] | undefined;
    socket.on("data", (data) => {
      buffer += data.toString();
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (message) {
          if (line !== ".") {
            message.push(line);
            continue;
          }
          messages.push(message.join("\r\n"));
          message = undefined;
          socket.write("250 queued-fixture\r\n");
        } else if (line.startsWith("EHLO")) {
          socket.write("250-local fixture\r\n250 8BITMIME\r\n");
        } else if (line.startsWith("RCPT TO:") && line.includes("reject@")) {
          socket.write("550 recipient refused\r\n");
        } else if (line === "DATA") {
          message = [];
          socket.write("354 end with dot\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind a TCP port");
  const transport = getSMTPTransport({
    smtp_host: "127.0.0.1",
    smtp_port: address.port,
    smtp_secure: false,
    smtp_user: "-",
    smtp_pass: "-",
    smtp_sender: "status@fixture.invalid",
  });
  return { transport, messages };
}

describe("native SMTP transport", () => {
  it("composes a notification and reports the local server's acceptance", async () => {
    const { transport, messages } = await smtpFixture();
    const info = await transport.sendMail({
      from: "status@fixture.invalid",
      to: "reader@fixture.invalid",
      subject: "Analysis API recovered",
      text: "The current observation is UP.",
      html: "<p>The current observation is <strong>UP</strong>.</p>",
    });
    expect(info.accepted).toEqual(["reader@fixture.invalid"]);
    expect(info.rejected).toEqual([]);
    expect(info.response).toBe("250 queued-fixture");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Subject: Analysis API recovered");
    expect(messages[0]).toContain("multipart/alternative");
    expect(messages[0]).toContain("The current observation is UP.");
  });

  it("returns a recipient refusal without submitting a message body", async () => {
    const { transport, messages } = await smtpFixture();
    await expect(
      transport.sendMail({
        from: "status@fixture.invalid",
        to: "reject@fixture.invalid",
        subject: "Failure",
        text: "Fixture",
      }),
    ).rejects.toMatchObject({ code: "EENVELOPE", responseCode: 550 });
    expect(messages).toEqual([]);
  });
});
