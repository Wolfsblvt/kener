import { GetBadge } from "$lib/server/controllers/controller.js";
import type { RequestHandler } from "./$types";
import { GuardAdmittedMonitor } from "$lib/server/publicOrigins.js";

export const GET: RequestHandler = async ({ params, url, locals }) => {
  await GuardAdmittedMonitor(
    locals.publicOrigin,
    params.tag,
    `/badge/${encodeURIComponent(params.tag)}/status`,
    url.search,
  );
  const query = url.searchParams;
  return GetBadge("status", {
    tag: params.tag,
    label: query.get("label"),
    labelColor: query.get("labelColor"),
    color: query.get("color"),
    style: query.get("style"),
    locale: query.get("locale"),
  });
};
