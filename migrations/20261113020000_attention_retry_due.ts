import type { Knex } from "knex";

/** Indexed due projection; authoritative retry/receipt state remains in state_json. */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("alert_notification_state", "next_retry_at")) return;
  await knex.schema.alterTable("alert_notification_state", (table) => {
    table.bigInteger("next_retry_at").nullable().index();
  });
  // Older source had no retry clock after RESOLVED. Resume its known rejected
  // attempts once; uncertain/sending/accepted state must never be armed here.
  const rows = await knex("alert_notification_state").select("alert_id", "trigger_id", "state_json");
  for (const row of rows) {
    const state = JSON.parse(row.state_json);
    const messages = state.messages ?? [];
    // Freeze this migration's no-effect criterion; application source is not
    // present beside migrations in the production image and may evolve later.
    if (
      messages.some(
        (item: { outcome: string; boundary?: string }) =>
          ["sending", "accepted", "unknown"].includes(item.outcome) ||
          (item.outcome === "failed" && !["telegram-rejection", "operator"].includes(item.boundary ?? "")),
      )
    )
      continue;
    if (messages.at(-1)?.outcome !== "failed") continue;
    await knex("alert_notification_state")
      .where({ alert_id: row.alert_id, trigger_id: row.trigger_id })
      .update({ next_retry_at: Math.floor(Date.now() / 1000) });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("alert_notification_state", "next_retry_at"))) return;
  await knex.schema.alterTable("alert_notification_state", (table) => {
    table.dropIndex("next_retry_at");
    table.dropColumn("next_retry_at");
  });
}
