import type { RequestHandler } from "./$types";
import { renderRssFeedResponse } from "$lib/server/rss.js";
import { GuardAdmittedMonitor } from "$lib/server/publicOrigins.js";

export const GET: RequestHandler = async ({ params, locals }) => {
  await GuardAdmittedMonitor(
    locals.publicOrigin,
    params.monitor_tag,
    `/monitors/${encodeURIComponent(params.monitor_tag)}/rss.xml`,
  );
  return renderRssFeedResponse({
    scope: { type: "monitor", tag: params.monitor_tag },
    feedPath: `/monitors/${params.monitor_tag}/rss.xml`,
    publicOrigin: locals.publicOrigin,
  });
};
