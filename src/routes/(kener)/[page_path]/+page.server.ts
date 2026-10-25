import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { GetPageDashboardData } from "$lib/server/controllers/dashboardController.js";
import { AdmittedCanonicalURL, GuardAdmittedPageRoute } from "$lib/server/publicOrigins.js";

export const load: PageServerLoad = async ({ params, parent, locals, url }) => {
  GuardAdmittedPageRoute(locals.publicOrigin, params.page_path, "/", url.search);
  const layoutData = await parent();
  const dashboardData = await GetPageDashboardData(params.page_path, layoutData);
  if (!dashboardData) {
    throw error(404, "Page Not Found");
  }

  // Until the site URL redirects this path, a page that is an admitted origin's Home names that Home canonical
  return {
    ...dashboardData,
    canonicalUrl: AdmittedCanonicalURL(locals.publicOrigin, params.page_path, "/"),
  };
};
