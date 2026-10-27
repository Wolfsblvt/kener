import type { Knex } from "knex";

export interface StandingReplacement {
  tag: string;
  replacement: string;
}

export class StandingRetirementConflict extends Error {
  constructor(public readonly reason: string) {
    super(`Standing retirement refused: ${reason}`);
  }
}

/** Validate the bounded operation, including retries whose source row is already absent. */
export function ValidateStandingReplacements(value: unknown): asserts value is StandingReplacement[] {
  if (!Array.isArray(value) || value.length === 0) throw new StandingRetirementConflict("invalid-replacements");
  const sources = new Set<string>();
  for (const pair of value) {
    if (
      !pair ||
      typeof pair.tag !== "string" ||
      !/^unknown-[a-z0-9][a-z0-9_-]*$/.test(pair.tag) ||
      typeof pair.replacement !== "string" ||
      !/^[a-z0-9][a-z0-9_-]*$/.test(pair.replacement) ||
      pair.tag === pair.replacement ||
      sources.has(pair.tag)
    )
      throw new StandingRetirementConflict("invalid-replacements");
    sources.add(pair.tag);
  }
  if (value.some((pair) => sources.has(pair.replacement))) throw new StandingRetirementConflict("replacement-chain");
}

// These are the tag-bearing tables in the maintained 4.1.9 schema. Update only the foreign identity:
// sample type/raw status, association settings/impact, row ids and all timestamps stay untouched.
const TAG_TABLES = [
  ["monitoring_data", "timestamp"],
  ["incident_monitors", "incident_id"],
  ["maintenance_monitors", "maintenance_id"],
  ["pages_monitors", "page_id"],
  ["monitor_alerts_config_monitors", "monitor_alerts_id"],
  ["monitor_alerts", null],
  ["monitor_alerts_v2", null],
  ["monitor_alerts_config", null],
] as const;

/** Reassociate the exact Unknown rows and retire them atomically; any collision rolls back the entire batch. */
export async function RetireStanding(knex: Knex, replacements: StandingReplacement[]) {
  ValidateStandingReplacements(replacements);
  return knex.transaction(async (trx) => {
    const results = [];
    for (const { tag, replacement } of replacements) {
      const target = await trx("monitors").where({ tag: replacement }).first();
      if (!target || target.monitor_type === "NONE" || target.monitor_type === "GROUP") {
        throw new StandingRetirementConflict("replacement-observation-missing");
      }
      const source = await trx("monitors").where({ tag }).first();
      if (!source) {
        results.push({ tag, replacement, outcome: "already-absent", moved: {} });
        continue;
      }
      let typeData;
      try {
        typeData = JSON.parse(source.type_data ?? "{}");
      } catch {
        throw new StandingRetirementConflict("placeholder-changed");
      }
      if (
        source.monitor_type !== "NONE" ||
        source.default_status !== "NO_DATA" ||
        !typeData ||
        Array.isArray(typeData) ||
        typeof typeData !== "object" ||
        Object.keys(typeData).length
      ) {
        throw new StandingRetirementConflict("placeholder-changed");
      }

      const moved: Record<string, number> = {};
      for (const [table, key] of TAG_TABLES) {
        if (key) {
          const overlap = await trx(`${table} as old`)
            .join(`${table} as current`, `old.${key}`, `current.${key}`)
            .where("old.monitor_tag", tag)
            .where("current.monitor_tag", replacement)
            .first();
          if (overlap) throw new StandingRetirementConflict(`${table}-collision`);
        }
        moved[table] = await trx(table).where({ monitor_tag: tag }).update({ monitor_tag: replacement });
      }

      // GROUP membership is JSON, not an FK. Preserve every member option and its exact position.
      // Two entries for one subject have no lossless rollup interpretation; do not silently deduplicate.
      const groups = await trx("monitors").where({ monitor_type: "GROUP" });
      moved.groups = 0;
      for (const group of groups) {
        const data = JSON.parse(group.type_data ?? "{}");
        const members = data?.monitors;
        if (!Array.isArray(members) || !members.some((member) => member.tag === tag)) continue;
        if (members.some((member) => member.tag === replacement))
          throw new StandingRetirementConflict("group-collision");
        data.monitors = members.map((member) => (member.tag === tag ? { ...member, tag: replacement } : member));
        await trx("monitors")
          .where({ id: group.id })
          .update({ type_data: JSON.stringify(data) });
        moved.groups++;
      }
      await trx("monitors").where({ id: source.id, tag }).del();
      results.push({ tag, replacement, outcome: "retired", moved });
    }
    return results;
  });
}
