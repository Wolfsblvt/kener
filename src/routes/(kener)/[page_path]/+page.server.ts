import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { GetPageDashboardData } from "$lib/server/controllers/dashboardController.js";
import { GuardAdmittedPageRoute } from "$lib/server/publicOrigins.js";

export const load: PageServerLoad = async ({ params, parent, locals, url }) => {
  GuardAdmittedPageRoute(locals.publicOrigin, params.page_path, "/", url.search);
  const layoutData = await parent();
  const dashboardData = await GetPageDashboardData(params.page_path, layoutData);
  if (!dashboardData) {
    throw error(404, "Page Not Found");
  }

  return {
    ...dashboardData,
  };
};
