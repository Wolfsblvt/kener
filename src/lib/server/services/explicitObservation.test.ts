import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
vi.mock("$lib/server/db/db", async () => {
  const { CreateTestDb } = await import("$lib/server/db/testDatabase");
  return { default: await CreateTestDb() };
});
import db from "../db/db";
import {
  IsExplicitApiObservation,
  ObservationStatusOf,
  ReadObservationStatus,
  ReadObservationAlertState,
} from "./explicitObservation";
import { CreateMonitorAlertConfig, UpdateMonitorAlertConfig } from "../controllers/monitorAlertConfigController";
import { GET as listMonitors } from "../../../routes/(api)/api/v4/monitors/+server";
import { buildMonitorBarResponse } from "../api-server/monitor-bar/shared";
import type { MonitoringData } from "../types/db";
const knex = (db as unknown as { knex: Knex }).knex;
const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const now = Date.UTC(2027, 0, 15, 8, 0) / 1000;
const monitor = {
  tag: "explicit",
  name: "Explicit HTTPS response",
  monitor_type: "API",
  cron: "*/5 * * * *",
  type_data: { observation_mode: "explicit" },
  created_at: new Date((now - 3600) * 1000).toISOString(),
};
beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name,
      getMigration: async (name: string) => migrations[name],
    },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now * 1000);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await knex("monitor_alerts_v2").del();
  await knex("monitor_alerts_config_monitors").del();
  await knex("monitor_alerts_config_triggers").del();
  await knex("monitor_alerts_config").del();
  await knex("maintenance_monitors").del();
  await knex("maintenances_events").del();
  await knex("maintenances").del();
  await knex("monitoring_data").del();
  await knex("monitors").del();
  await knex("monitors").insert({
    ...monitor,
    created_at: new Date((now - 3600) * 1000),
    status: "ACTIVE",
    is_hidden: "NO",
    type_data: JSON.stringify(monitor.type_data),
  });
});
async function sample(age: number, status: string, type = "REALTIME", raw_status = status) {
  return await db.insertMonitoringData({
    monitor_tag: monitor.tag,
    timestamp: now - age * 60,
    status,
    type,
    latency: 1,
    raw_status,
  });
}

describe("native explicit observation persistence and consumers", () => {
  it("exposes the finite contract and keeps actual NO_DATA in history/current bars", async () => {
    await sample(0, "NO_DATA", "ERROR");
    const history = await db.getMonitoringData(monitor.tag, now - 60, now + 60);
    expect(history[0]).toMatchObject({ status: "NO_DATA", raw_status: "NO_DATA", type: "ERROR" });
    const response = await listMonitors({ url: new URL("http://localhost/api/v4/monitors") } as never);
    expect(await response.json()).toHaveProperty("observation_contract", "wolf-explicit-api-observation-v1");
    expect(
      (await buildMonitorBarResponse((await db.getMonitorByTag(monitor.tag)) as never, 1, now)).currentStatus,
    ).toBe("NO_DATA");
  });
  it("refuses stale, manual/default, future and transport values as current health", async () => {
    const latest = await sample(15, "UP");
    expect(await ReadObservationStatus(monitor, latest, now)).toBe("NO_DATA");
    for (const type of ["MANUAL", "DEFAULT", "ERROR", "TIMEOUT"])
      expect(
        ObservationStatusOf(monitor, { ...latest, timestamp: now, type, status: "UP" } as MonitoringData, now),
      ).toBe("NO_DATA");
    expect(ObservationStatusOf(monitor, { ...latest, timestamp: now + 60, status: "UP" } as MonitoringData, now)).toBe(
      "NO_DATA",
    );
  });
  it("distinguishes confirmed missing observation, a missing run, and known response recovery", async () => {
    await sample(5, "NO_DATA", "ERROR");
    expect(await ReadObservationAlertState(monitor, 2, 2, now)).toEqual({ affected: false, recovered: false });
    await sample(0, "NO_DATA", "TIMEOUT");
    expect(await ReadObservationAlertState(monitor, 2, 2, now)).toEqual({ affected: true, recovered: false });
    await knex("monitoring_data").del();
    await sample(15, "UP");
    expect(await ReadObservationAlertState(monitor, 2, 2, now)).toEqual({ affected: true, recovered: false });
    await sample(5, "UP");
    await sample(0, "DOWN");
    expect(await ReadObservationAlertState(monitor, 2, 2, now)).toEqual({ affected: false, recovered: true });
  });
  it("manual/default/future rows cannot refresh the real observation clock", async () => {
    await sample(15, "UP");
    await sample(0, "UP", "MANUAL");
    await sample(-5, "UP");
    expect(await ReadObservationAlertState(monitor, 2, 1, now)).toEqual({ affected: true, recovered: false });
  });
  it("keeps finite maintenance visible, freezes unknown alerting, then exposes underlying unknown at its exclusive end", async () => {
    await sample(5, "NO_DATA", "ERROR");
    await sample(0, "NO_DATA", "ERROR");
    await knex("maintenances").insert({
      id: 1,
      title: "Finite planned sleep",
      status: "ACTIVE",
      start_date_time: now - 60,
      rrule: "FREQ=MINUTELY;COUNT=1",
      duration_seconds: 120,
    });
    await knex("maintenance_monitors").insert({
      maintenance_id: 1,
      monitor_tag: monitor.tag,
      monitor_impact: "MAINTENANCE",
    });
    await knex("maintenances_events").insert({
      maintenance_id: 1,
      start_date_time: now - 60,
      end_date_time: now + 60,
      status: "ONGOING",
    });
    expect(await ReadObservationStatus(monitor, await db.getLatestMonitoringData(monitor.tag), now)).toBe(
      "MAINTENANCE",
    );
    expect(await ReadObservationAlertState(monitor, 2, 1, now)).toEqual({ affected: false, recovered: false });
    expect(await ReadObservationStatus(monitor, await db.getLatestMonitoringData(monitor.tag), now + 60)).toBe(
      "NO_DATA",
    );
    expect((await ReadObservationAlertState(monitor, 2, 1, now + 60)).affected).toBe(true);
  });
  it("allows no-observation notifications and refuses an application-incident/legacy contract, including partial update", async () => {
    const input = {
      monitor_tags: [monitor.tag],
      alert_for: "STATUS" as const,
      alert_value: "NO_DATA",
      failure_threshold: 2,
      success_threshold: 2,
      create_incident: "NO" as const,
    };
    const config = await CreateMonitorAlertConfig(input);
    await expect(UpdateMonitorAlertConfig({ id: config.id, create_incident: "YES" })).rejects.toThrow(
      /application incidents/,
    );
    await knex("monitors").insert({ tag: "legacy", name: "Legacy", monitor_type: "API", type_data: "{}" });
    await expect(CreateMonitorAlertConfig({ ...input, monitor_tags: ["legacy"] })).rejects.toThrow(
      /observation_mode explicit/,
    );
    expect(IsExplicitApiObservation({ ...monitor, type_data: "{}" })).toBe(false);
  });
});
