import type { Knex } from "knex";

/** Sender state belongs to the same database/backup boundary as its native alert. */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("alert_notification_state")) return;
  await knex.schema.createTable("alert_notification_state", (table) => {
    table
      .integer("alert_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("monitor_alerts_v2")
      .onDelete("CASCADE");
    table.integer("trigger_id").unsigned().notNullable().references("id").inTable("triggers").onDelete("CASCADE");
    table.primary(["alert_id", "trigger_id"]);
    table.integer("revision").notNullable().defaultTo(0);
    table.text("state_json", "longtext").notNullable();
  });
}

/** Export valued receipts before deliberately rolling back this migration. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_notification_state");
}
