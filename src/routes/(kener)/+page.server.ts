import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { GetPageDashboardData } from "$lib/server/controllers/dashboardController.js";
import { AdmittedCanonicalURL } from "$lib/server/publicOrigins.js";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const layoutData = await parent();
  // An admitted public origin serves its own page here instead of the home page
  const dashboardData = await GetPageDashboardData(locals.publicOrigin?.pagePath ?? "", layoutData);
  if (!dashboardData) {
    throw error(404, "Page Not Found");
  }
  return {
    ...dashboardData,
    canonicalUrl: AdmittedCanonicalURL(locals.publicOrigin, "", "/"),
  };
};
