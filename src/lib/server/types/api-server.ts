import type { Cookies } from "@sveltejs/kit";

export interface APIServerRequest {
  action: string;
  query: URLSearchParams;
  cookies: Cookies;
  headers: Headers;
  body?: any;
  // The admitted public origin (KENER_PUBLIC_ORIGINS) the request arrived on, from locals
  publicOrigin?: import("$lib/server/publicOrigins").PublicOrigin | null;
}

export type APIHandler = (req: APIServerRequest) => Response | Promise<Response>;
