import { GetMonitors, GetLatestMonitoringData, GetLatestStatusActiveAll } from "$lib/server/controllers/controller.js";
import StatusColor, { type StatusColors } from "$lib/color.js";
import { ErrorSvg } from "$lib/anywhere.js";
import GC from "$lib/global-constants.js";
import type { StatusType } from "$lib/types/status.js";
import { GetLastMonitoringValue } from "$lib/server/cache/setGet.js";
import { CurrentStatusOf } from "$lib/server/services/statusFreshness.js";
import { GetMinuteStartNowTimestampUTC } from "$lib/server/tool.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, url }) => {
  let currentStatus: string;
  const { tag } = params;
  if (tag == "_") {
    currentStatus = (await GetLatestStatusActiveAll()).status;
  } else {
    const ms = await GetMonitors({ tag: params.tag, status: "ACTIVE", is_hidden: "NO" });
    if (ms.length === 0) {
      return new Response(ErrorSvg, {
        headers: {
          "Content-Type": "image/svg+xml",
        },
      });
    }
    const lastObj = await GetLastMonitoringValue(tag, () => GetLatestMonitoringData(tag));
    currentStatus = CurrentStatusOf(ms[0].cron, lastObj, GetMinuteStartNowTimestampUTC());
  }
  //read query params
  const query = url.searchParams;
  const animate = query.get("animate") || "";
  const myColors: StatusColors = await StatusColor();
  const statusToMap = currentStatus as StatusType;

  const fillColor = query.get("fillColor") || myColors[statusToMap];
  let svg = `
	<svg width="32" height="32"  xmlns="http://www.w3.org/2000/svg">
		<circle cx="16" cy="16" r="8" fill="${fillColor}" />
	</svg>
	`;
  if (animate == "ping") {
    svg = `
	<svg width="32" height="32"  xmlns="http://www.w3.org/2000/svg">
		<circle cx="16" cy="16" r="8" fill="${fillColor}" opacity="0.5">
			<animate 
				attributeName="r" 
				from="8" 
				to="16" 
				dur="1s" 
				repeatCount="indefinite" />
			<animate 
				attributeName="opacity" 
				from="0.5" 
				to="0" 
				dur="1s" 
				repeatCount="indefinite" />
		</circle>
		<circle cx="16" cy="16" r="8" fill="${fillColor}" />
</svg>
	`;
  }

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
    },
  });
};
