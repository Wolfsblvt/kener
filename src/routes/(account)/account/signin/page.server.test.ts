import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import jwt from "jsonwebtoken";

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
vi.mock("$lib/server/db/db", async () => {
  const { CreateTestDb } = await import("$lib/server/db/testDatabase");
  return { default: await CreateTestDb() };
});
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));
vi.mock("$lib/server/notification/email_notification", () => ({ default: vi.fn(async () => {}) }));
vi.mock("$lib/server/queues/subscriberQueue", () => ({ default: { push: vi.fn() } }));
vi.mock("$lib/server/queues/alertingQueue", () => ({ default: { push: vi.fn() } }));

import db from "$lib/server/db/db";
import { actions } from "./+page.server";
import { SendInvitationEmail } from "$lib/server/controllers/userController";
import { FindOrCreateOidcUser, GenerateOidcSession } from "$lib/server/controllers/oidcController";
import { VerifySubscriberOTP } from "$lib/server/controllers/userSubscriptionsController";
import type { OidcSettings } from "$lib/types/site";
import { seed as seedPermissions } from "../../../../../seeds/permissions";
import { seed as seedRoles } from "../../../../../seeds/roles";
import { seed as seedSiteData } from "../../../../../seeds/site_data";

const knex = (db as unknown as { knex: Knex }).knex;
type SigninEvent = Parameters<NonNullable<(typeof actions)["signup"]>>[0];
const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const SECRET = "synthetic-auth-admission-test-key";
const EMAIL = "owner@example.test";
const PASSWORD = "SyntheticPassword123";
const AUTH_TABLES = ["user_subscriptions_v2", "subscriber_methods", "subscriber_users", "users_roles", "users"];
const oidcSettings = { auto_create_users: true, default_role_id: "member" } as OidcSettings;
const oidcData = { sub: "synthetic-sub", email: "oidc@example.test", name: "OIDC User", groups: [] };

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name.slice("/migrations/".length),
      getMigration: async (name: string) => migrations[name],
    },
  });
  await seedPermissions(knex);
  await seedRoles(knex);
  await seedSiteData(knex);
});
beforeEach(async () => {
  vi.stubEnv("KENER_SECRET_KEY", SECRET);
  vi.stubEnv("ORIGIN", "http://example.test");
  vi.stubEnv("REDIS_URL", "redis://unused.example.test");
  for (const table of AUTH_TABLES) await knex(table).del();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => knex.destroy());

function event() {
  const body = new URLSearchParams({ name: "First Owner", email: EMAIL, password: PASSWORD });
  const request = new Request("http://example.test/account/signin?/signup", { method: "POST", body });
  const formData = vi.spyOn(request, "formData");
  const cookies = { set: vi.fn<(name: string, value: string, options: Record<string, unknown>) => void>() };
  return { input: { request, cookies } as unknown as SigninEvent, formData, cookies };
}

async function snapshot() {
  const rows: Record<string, unknown[]> = {};
  for (const table of AUTH_TABLES) rows[table] = await knex(table).select("*");
  return rows;
}

describe.each([undefined, ""])("authentication admission with KENER_SECRET_KEY=%s", (key) => {
  it.each(["signup", "login"] as const)(
    "refuses the direct %s action before reading the form or writing authority",
    async (action) => {
      const { input, formData, cookies } = event();
      const before = await snapshot();
      vi.stubEnv("KENER_SECRET_KEY", key);

      const result = await Promise.resolve(actions[action]!(input)).catch((error: unknown) => error);

      expect(await snapshot()).toEqual(before);
      expect(result).toMatchObject({ status: 503, data: { error: expect.any(String) } });
      expect(formData).not.toHaveBeenCalled();
      expect(cookies.set).not.toHaveBeenCalled();
    },
  );

  it("keeps the subscriber pending, including its OTP and methods", async () => {
    await knex("subscriber_users").insert({
      email: EMAIL,
      status: "PENDING",
      verification_code: "123456",
      verification_expires_at: new Date(Date.now() + 60_000),
    });
    const before = await snapshot();
    vi.stubEnv("KENER_SECRET_KEY", key);

    await expect(VerifySubscriberOTP(EMAIL, "123456")).rejects.toThrow(/KENER_SECRET_KEY is not set/);
    expect(await snapshot()).toEqual(before);
  });

  it("does not provision an OIDC user or its roles", async () => {
    const before = await snapshot();
    vi.stubEnv("KENER_SECRET_KEY", key);

    await expect(FindOrCreateOidcUser(oidcSettings, oidcData)).rejects.toThrow(/KENER_SECRET_KEY is not set/);
    expect(await snapshot()).toEqual(before);
  });

  it("does not synchronize an existing OIDC profile or roles", async () => {
    await db.insertUser({
      email: oidcData.email,
      name: "Original Name",
      password_hash: "",
      auth_provider: "oidc",
      oidc_sub: oidcData.sub,
      role_ids: ["admin"],
    });
    const before = await snapshot();
    vi.stubEnv("KENER_SECRET_KEY", key);

    await expect(FindOrCreateOidcUser(oidcSettings, { ...oidcData, name: "Changed Name" })).rejects.toThrow(
      /KENER_SECRET_KEY is not set/,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("does not create an invitation user or roles", async () => {
    const before = await snapshot();
    vi.stubEnv("KENER_SECRET_KEY", key);

    await expect(SendInvitationEmail(EMAIL, ["member"], "Invited User")).rejects.toThrow(/KENER_SECRET_KEY is not set/);
    expect(await snapshot()).toEqual(before);
  });
});

describe("configured authentication keeps working", () => {
  it("keeps direct signup and login working when development infers ORIGIN", async () => {
    vi.stubEnv("ORIGIN", undefined);
    const signup = event();
    await expect(actions.signup!(signup.input)).rejects.toMatchObject({ status: 302 });
    const login = event();
    await expect(actions.login!(login.input)).rejects.toMatchObject({ status: 302 });
    expect(jwt.verify(login.cookies.set.mock.calls[0][1], SECRET)).toMatchObject({ email: EMAIL });
  });

  it("creates the first owner and signs both signup and local-login sessions", async () => {
    const signup = event();
    await expect(actions.signup!(signup.input)).rejects.toMatchObject({ status: 302 });
    const user = await db.getUserByEmail(EMAIL);
    expect(user).toMatchObject({ is_owner: "YES", role_ids: ["admin"] });
    expect(jwt.verify(signup.cookies.set.mock.calls[0][1], SECRET)).toMatchObject({ email: EMAIL });

    const login = event();
    await expect(actions.login!(login.input)).rejects.toMatchObject({ status: 302 });
    expect(jwt.verify(login.cookies.set.mock.calls[0][1], SECRET)).toMatchObject({ email: EMAIL });
  });

  it("activates a verified subscriber, consumes the OTP and signs the method token", async () => {
    await knex("subscriber_users").insert({
      email: EMAIL,
      status: "PENDING",
      verification_code: "123456",
      verification_expires_at: new Date(Date.now() + 60_000),
    });
    const result = await VerifySubscriberOTP(EMAIL, "123456");
    expect(result.success).toBe(true);
    expect(jwt.verify(result.token!, SECRET)).toMatchObject({ email: EMAIL, type: "subscriber" });
    expect(await knex("subscriber_users").first()).toMatchObject({ status: "ACTIVE", verification_code: null });
    expect(await knex("subscriber_methods").first()).toMatchObject({ status: "ACTIVE", method_type: "email" });
  });

  it("provisions and synchronizes OIDC users and signs their sessions", async () => {
    const user = await FindOrCreateOidcUser(oidcSettings, oidcData);
    expect(user).toMatchObject({ email: oidcData.email, role_ids: ["member"] });
    const updated = await FindOrCreateOidcUser(oidcSettings, { ...oidcData, name: "Changed Name" });
    expect(updated.name).toBe("Changed Name");
    const session = await GenerateOidcSession(updated);
    expect(jwt.verify(session.token, SECRET)).toMatchObject({ email: oidcData.email });
  });

  it("creates an invitation with its selected roles", async () => {
    await SendInvitationEmail(EMAIL, ["member"], "Invited User");
    expect(await db.getUserByEmail(EMAIL)).toMatchObject({ email: EMAIL, name: "Invited User", role_ids: ["member"] });
  });
});
