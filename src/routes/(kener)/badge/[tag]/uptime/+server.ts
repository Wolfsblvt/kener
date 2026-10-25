import type { RequestHandler } from "./$types";
import { GuardAdmittedMonitor } from "$lib/server/publicOrigins.js";
import { GetBadge } from "$lib/server/controllers/controller.js";

export const GET: RequestHandler = async ({ params, url, locals }) => {
  await GuardAdmittedMonitor(
    locals.publicOrigin,
    params.tag,
    `/badge/${encodeURIComponent(params.tag)}/uptime`,
    url.search,
  );
  const query = url.searchParams;
  return GetBadge("uptime", {
    tag: params.tag,
    sinceLast: query.get("sinceLast"),
    hideDuration: query.get("hideDuration"),
    label: query.get("label"),
    labelColor: query.get("labelColor"),
    color: query.get("color"),
    style: query.get("style"),
  });
};
