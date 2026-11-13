import { BaseRepository, type TriggerFilter, type CountResult } from "./base.js";
import type { MonitorAlert, MonitorAlertInsert, TriggerRecord, TriggerRecordInsert } from "../../types/db.js";
import type { AttentionRecord, AttentionState } from "../../notification/attentionTypes.js";

/**
 * Repository for alerts and triggers operations
 */
export class AlertsRepository extends BaseRepository {
  /** Read without creating state; operator GET never changes a sender record. */
  async getAttentionState(alert_id: number, trigger_id: number): Promise<AttentionRecord | undefined> {
    const result = await this.knex("alert_notification_state").where({ alert_id, trigger_id }).first();
    return result ? { revision: Number(result.revision), state: JSON.parse(result.state_json) } : undefined;
  }

  /** Initialise once; a concurrent creator never replaces valued receipts. */
  async ensureAttentionState(alert_id: number, trigger_id: number): Promise<AttentionRecord> {
    await this.knex("alert_notification_state")
      .insert({ alert_id, trigger_id, revision: 0, state_json: JSON.stringify({ facts: {}, messages: [] }) })
      .onConflict(["alert_id", "trigger_id"])
      .ignore();
    return (await this.getAttentionState(alert_id, trigger_id))!;
  }

  /** CAS covers dispatch claims, completion and operator changes; no lock spans HTTP. */
  async saveAttentionState(
    alert_id: number,
    trigger_id: number,
    revision: number,
    state: AttentionState,
  ): Promise<boolean> {
    const count = await this.knex("alert_notification_state")
      .where({ alert_id, trigger_id, revision })
      .update({
        revision: revision + 1,
        state_json: JSON.stringify(state),
        next_retry_at: state.retry?.nextAt ? Math.floor(Date.parse(state.retry.nextAt) / 1000) : null,
      });
    return count === 1;
  }

  /** Indexed due rows only; active and resolved alerts share the same retry clock. */
  async getDueAttentionRetries(
    now: number,
    triggerIds: number[],
  ): Promise<Array<{ alert_id: number; trigger_id: number }>> {
    return this.knex("alert_notification_state")
      .select("alert_id", "trigger_id")
      .whereIn("trigger_id", triggerIds)
      .where("next_retry_at", "<=", now);
  }

  // ============ Monitor Alerts ============

  async insertAlert(data: MonitorAlertInsert): Promise<number[]> {
    return await this.knex("monitor_alerts").insert({
      monitor_tag: data.monitor_tag,
      monitor_status: data.monitor_status,
      alert_status: data.alert_status,
      health_checks: data.health_checks,
    });
  }

  async alertExistsIncident(incident_number: number): Promise<boolean> {
    const result = await this.knex("monitor_alerts")
      .count("* as count")
      .where({ incident_number })
      .first<CountResult>();
    return Number(result?.count) > 0;
  }

  async alertExists(monitor_tag: string, monitor_status: string, alert_status: string): Promise<boolean> {
    const result = await this.knex("monitor_alerts")
      .count("* as count")
      .where({ monitor_tag, monitor_status, alert_status })
      .first<CountResult>();
    return Number(result?.count) > 0;
  }

  async getActiveAlertIncident(
    monitor_tag: string,
    monitor_status: string,
    incident_number: number,
  ): Promise<MonitorAlert | undefined> {
    return await this.knex("monitor_alerts").where({ monitor_tag, monitor_status, incident_number }).first();
  }

  async getAllActiveAlertIncidents(monitor_tag: string): Promise<MonitorAlert[]> {
    return await this.knex("monitor_alerts")
      .where({ monitor_tag, alert_status: "TRIGGERED" })
      .andWhere("incident_number", ">", 0)
      .orderBy("id", "desc");
  }

  async getActiveAlert(
    monitor_tag: string,
    monitor_status: string,
    alert_status: string,
  ): Promise<MonitorAlert | undefined> {
    return await this.knex("monitor_alerts").where({ monitor_tag, monitor_status, alert_status }).first();
  }

  async getMonitorAlertsPaginated(page: number, limit: number): Promise<MonitorAlert[]> {
    return await this.knex("monitor_alerts")
      .orderBy("id", "desc")
      .limit(limit)
      .offset((page - 1) * limit);
  }

  async getMonitorAlertsCount(): Promise<CountResult | undefined> {
    return await this.knex("monitor_alerts").count("* as count").first<CountResult>();
  }

  async updateAlertStatus(id: number, alert_status: string): Promise<number> {
    return await this.knex("monitor_alerts").where({ id }).update({
      alert_status,
      updated_at: this.knex.fn.now(),
    });
  }

  async incrementAlertHealthChecks(id: number): Promise<number> {
    return await this.knex("monitor_alerts")
      .where({ id })
      .increment("health_checks", 1)
      .update({ updated_at: this.knex.fn.now() });
  }

  async addIncidentNumberToAlert(id: number, incident_number: number): Promise<number> {
    return await this.knex("monitor_alerts").where({ id }).update({
      incident_number,
      updated_at: this.knex.fn.now(),
    });
  }

  async deleteMonitorAlertsByTag(tag: string): Promise<number> {
    return await this.knex("monitor_alerts").where("monitor_tag", tag).del();
  }

  // ============ Triggers ============

  async createNewTrigger(data: TriggerRecordInsert): Promise<number[]> {
    return await this.knex("triggers").insert({
      name: data.name,
      trigger_type: data.trigger_type,
      trigger_status: data.trigger_status,
      trigger_meta: data.trigger_meta,
      trigger_desc: data.trigger_desc,
      created_at: this.knex.fn.now(),
      updated_at: this.knex.fn.now(),
    });
  }

  async updateTrigger(data: TriggerRecord): Promise<number> {
    return await this.knex("triggers").where({ id: data.id }).update({
      name: data.name,
      trigger_type: data.trigger_type,
      trigger_status: data.trigger_status,
      trigger_desc: data.trigger_desc,
      trigger_meta: data.trigger_meta,
      updated_at: this.knex.fn.now(),
    });
  }

  async getTriggers(data: TriggerFilter): Promise<TriggerRecord[]> {
    let query = this.knex("triggers").whereRaw("1=1");
    if (!!data.status) {
      query = query.andWhere("trigger_status", data.status);
    }
    if (!!data.id) {
      query = query.andWhere("id", data.id);
    }
    return await query.orderBy("id", "desc");
  }

  async getTriggerByID(id: number): Promise<TriggerRecord | undefined> {
    return await this.knex("triggers").where("id", id).first();
  }
  //get by ids
  async getTriggersByIDs(ids: number[]): Promise<TriggerRecord[]> {
    return await this.knex("triggers").whereIn("id", ids);
  }

  async deleteTrigger(id: number): Promise<number> {
    // First delete any references in monitor_alerts_config_triggers
    await this.knex("monitor_alerts_config_triggers").where("trigger_id", id).del();
    // Then delete the trigger itself
    return await this.knex("triggers").where("id", id).del();
  }
}
