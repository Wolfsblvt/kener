import type { RequestHandler } from "./$types";
import { renderRssFeedResponse } from "$lib/server/rss.js";
import { GuardAdmittedPageRoute } from "$lib/server/publicOrigins.js";

export const GET: RequestHandler = ({ params, locals }) => {
  GuardAdmittedPageRoute(locals.publicOrigin, params.page_path, "/rss.xml");
  return renderRssFeedResponse({
    scope: { type: "page", pagePath: params.page_path },
    feedPath: `/${params.page_path}/rss.xml`,
  });
};
