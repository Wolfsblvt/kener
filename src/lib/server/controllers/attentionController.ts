import db from "../db/db.js";
import { GetAllSiteData } from "./siteDataController.js";
import { GetTriggersByMonitorAlertConfigId } from "./monitorAlertConfigController.js";
import { readAttentionConfig } from "../notification/attentionComposer.js";
import { applyAttentionChange } from "../notification/attentionOperator.js";
import { dispatchAttention } from "../notification/attentionDispatch.js";
import { alertToVariables, siteDataToVariables } from "../notification/notification_utils.js";

export class AttentionOperationError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Only an existing native alert/trigger relationship selected by the operated binding is addressable. */
async function selected(params: Record<string, string | undefined>) {
  if (
    ![params.alert_id, params.trigger_id].every(
      (value) => /^[1-9]\d*$/.test(value ?? "") && Number(value) <= 2147483647,
    )
  )
    throw new AttentionOperationError(404, "attention_not_found");
  const alertId = Number(params.alert_id),
    triggerId = Number(params.trigger_id);
  const alert = await db.getMonitorAlertV2WithConfig(alertId);
  if (!alert) throw new AttentionOperationError(404, "attention_not_found");
  const triggers = await GetTriggersByMonitorAlertConfigId(alert.config_id);
  const trigger = triggers.find((item) => item.id === triggerId);
  if (!trigger) throw new AttentionOperationError(404, "attention_not_found");
  // A persisted attempt remains recoverable even after removal or breakage of
  // the current configuration/artifacts. Existing bearer/relationship checks stay.
  if (
    !(await db.getAttentionState(alertId, triggerId)) &&
    !(await readAttentionConfig())?.triggerIds.includes(triggerId)
  )
    throw new AttentionOperationError(404, "attention_not_found");
  return { alert, trigger, alertId, triggerId };
}

export async function ReadAttention(params: Record<string, string | undefined>) {
  const target = await selected(params);
  return {
    record: (await db.getAttentionState(target.alertId, target.triggerId)) ?? null,
    receiptMeaning: "qualified submission; device/human receipt unobserved",
  };
}

/** Custody/reconciliation changes state only; they do not implicitly invoke a send. */
export async function ChangeAttention(params: Record<string, string | undefined>, input: Record<string, unknown>) {
  const target = await selected(params);
  const record = await db.ensureAttentionState(target.alertId, target.triggerId);
  let state;
  try {
    state = applyAttentionChange(record, input);
  } catch {
    throw new AttentionOperationError(409, "attention_revision_or_input_conflict");
  }
  if (!(await db.saveAttentionState(target.alertId, target.triggerId, record.revision, state)))
    throw new AttentionOperationError(409, "attention_revision_conflict");
  return { revision: record.revision + 1, state, evaluated: false };
}

/** Explicit continuation after delivery reconciliation, including a held resolved alert. */
export async function EvaluateAttention(params: Record<string, string | undefined>, input: Record<string, unknown>) {
  const target = await selected(params);
  const record = await db.getAttentionState(target.alertId, target.triggerId);
  if (!record || input?.action !== "evaluate" || input.revision !== record.revision)
    throw new AttentionOperationError(409, "attention_revision_conflict");
  const site = siteDataToVariables(await GetAllSiteData());
  const tag = target.alert.monitor_tag;
  if (!tag) throw new AttentionOperationError(409, "attention_monitor_unavailable");
  const dispatched = await dispatchAttention(
    target.alert,
    target.alert.config,
    target.trigger,
    alertToVariables(target.alert.config, target.alert, site, tag, tag),
    new Date().toISOString(),
    record.revision,
  );
  if (!dispatched) throw new AttentionOperationError(409, "attention_binding_unavailable");
  return { record: await db.getAttentionState(target.alertId, target.triggerId), deviceReceipt: "unobserved" };
}
