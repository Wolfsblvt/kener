import type { Knex } from "knex";
import { isDeepStrictEqual } from "node:util";

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

// These are the tag-bearing tables in the maintained 4.1.9 schema.
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

/** Compare valued content, independent of association identity, chronology and page rank. */
function content(row: Record<string, unknown>, page = false) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(
        ([key]) => !["id", "monitor_tag", "created_at", "updated_at", ...(page ? ["position"] : [])].includes(key),
      )
      .map(([key, value]) => [
        key,
        key === "monitor_settings_json" && typeof value === "string" ? JSON.parse(value) : value,
      ]),
  );
}

/** Reconcile complete destination groups in one transaction; conflicting valued content refuses the whole batch. */
export async function RetireStanding(knex: Knex, replacements: StandingReplacement[]) {
  ValidateStandingReplacements(replacements);
  return knex.transaction(async (trx) => {
    const results = new Map<
      string,
      { tag: string; replacement: string; outcome: string; moved: Record<string, number> }
    >();
    const destinations = new Map<string, string[]>();
    for (const { tag, replacement } of replacements) {
      destinations.set(replacement, [...(destinations.get(replacement) ?? []), tag]);
    }
    for (const [replacement, tags] of destinations) {
      const target = await trx("monitors").where({ tag: replacement }).first();
      if (!target || target.monitor_type === "NONE" || target.monitor_type === "GROUP") {
        throw new StandingRetirementConflict("replacement-observation-missing");
      }
      const sources = [];
      for (const tag of tags) {
        const source = await trx("monitors").where({ tag }).first();
        if (!source) {
          results.set(tag, { tag, replacement, outcome: "already-absent", moved: {} });
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
        sources.push(source);
        results.set(tag, { tag, replacement, outcome: "retired", moved: {} });
      }
      if (!sources.length) continue;
      const activeTags = sources.map((source) => source.tag as string);
      for (const [table, key] of TAG_TABLES) {
        const rows = await trx(table).whereIn("monitor_tag", [replacement, ...activeTags]);
        // Prefer an existing real association, then source order. Only identical valued content collapses.
        rows.sort(
          (a, b) =>
            [replacement, ...activeTags].indexOf(a.monitor_tag) - [replacement, ...activeTags].indexOf(b.monitor_tag),
        );
        const retained = new Map<unknown, Record<string, unknown>>();
        for (const row of rows) {
          const previous = key ? retained.get(row[key]) : undefined;
          if (
            previous &&
            !isDeepStrictEqual(content(previous, table === "pages_monitors"), content(row, table === "pages_monitors"))
          ) {
            throw new StandingRetirementConflict(`${table}-collision`);
          }
          if (row.monitor_tag === replacement) {
            if (key) retained.set(row[key], row);
            continue;
          }
          const moved = results.get(row.monitor_tag)!.moved;
          moved[table] = (moved[table] ?? 0) + 1;
          const identity = key ? { monitor_tag: row.monitor_tag, [key]: row[key] } : { id: row.id };
          if (previous) await trx(table).where(identity).del();
          else {
            await trx(table).where(identity).update({ monitor_tag: replacement });
            if (key) retained.set(row[key], row);
          }
        }
      }

      // GROUP membership is JSON. Equal member options collapse at the existing destination's position,
      // or the first source position; a different role/weight/option refuses rather than choosing a loss.
      const groups = await trx("monitors").where({ monitor_type: "GROUP" });
      for (const group of groups) {
        const data = JSON.parse(group.type_data ?? "{}");
        const members = data?.monitors;
        if (!Array.isArray(members) || !members.some((member) => activeTags.includes(member.tag))) continue;
        const affected = members.filter((member) => member.tag === replacement || activeTags.includes(member.tag));
        const keeper = affected.find((member) => member.tag === replacement) ?? affected[0];
        const options = ({ tag: _tag, ...rest }: Record<string, unknown>) => rest;
        if (affected.some((member) => !isDeepStrictEqual(options(keeper), options(member)))) {
          throw new StandingRetirementConflict("group-collision");
        }
        data.monitors = members.flatMap((member) =>
          !affected.includes(member) ? [member] : member === keeper ? [{ ...member, tag: replacement }] : [],
        );
        for (const tag of activeTags) {
          if (members.some((member) => member.tag === tag)) {
            const moved = results.get(tag)!.moved;
            moved.groups = (moved.groups ?? 0) + 1;
          }
        }
        await trx("monitors")
          .where({ id: group.id })
          .update({ type_data: JSON.stringify(data) });
      }
      for (const source of sources) await trx("monitors").where({ id: source.id, tag: source.tag }).del();
    }
    return replacements.map(({ tag }) => results.get(tag)!);
  });
}
