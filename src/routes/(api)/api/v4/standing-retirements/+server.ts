import { json, type RequestHandler } from "@sveltejs/kit";
import { RetireStandingMonitors } from "$lib/server/controllers/monitorsController";
import {
  StandingRetirementConflict,
  ValidateStandingReplacements,
} from "$lib/server/db/repositories/standingRetirement";

/** Bearer-authenticated Unknown-to-observation reassociation, separate from destructive monitor DELETE. */
export const POST: RequestHandler = async ({ request }) => {
  let replacements;
  try {
    replacements = (await request.json()).replacements;
    ValidateStandingReplacements(replacements);
  } catch {
    return json(
      { error: { code: "BAD_REQUEST", message: "Supply exact Unknown-to-observation replacements." } },
      { status: 400 },
    );
  }
  try {
    const results = await RetireStandingMonitors(replacements);
    return json({ results });
  } catch (error) {
    if (error instanceof StandingRetirementConflict) {
      return json({ error: { code: "STANDING_RETIREMENT_CONFLICT", reason: error.reason } }, { status: 409 });
    }
    // A cache/transport failure can follow a committed transaction. Do not report rollback or expose native diagnostics.
    return json(
      { error: { code: "RETIREMENT_UNOBSERVED", message: "Read the exact source and replacement before retrying." } },
      { status: 500 },
    );
  }
};
