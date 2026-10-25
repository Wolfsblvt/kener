import type { LayoutServerLoad } from "./$types";
import { GetLayoutServerData } from "$lib/server/controllers/layoutController";

export const load: LayoutServerLoad = async ({ cookies, request, locals }) => {
  return await GetLayoutServerData(cookies, request, locals.publicOrigin);
};
