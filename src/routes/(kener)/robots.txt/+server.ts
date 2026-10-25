import { GetSiteDataByKey } from "$lib/server/controllers/siteDataController.js";
import serverResolver from "$lib/server/resolver.js";
import type { SitemapXMLConfig } from "$lib/types/site.js";
import type { RequestHandler } from "./$types";

const RULES = `User-agent: *
Allow: /
Disallow: /manage/
Disallow: /account/
Disallow: /api/
Disallow: /embed/

# AI Search Engine Crawlers
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /
`;

const LLMS_INDEX = `
# AI Documentation Index
# See https://llmstxt.org for specification
# /llms.txt redirects to the latest version
`;

// Names this host's own sitemap, and only when /sitemap.xml serves one: on an admitted public origin that
// origin's, otherwise the site URL's. The host comes from configuration, never from the request.
export const GET: RequestHandler = async ({ locals }) => {
  const sitemap = (await GetSiteDataByKey("sitemap")) as SitemapXMLConfig | null;
  const origin = locals.publicOrigin?.origin ?? ((await GetSiteDataByKey("siteURL")) as string | null);
  const sitemapLine =
    (sitemap?.mode ?? "auto") !== "off" && origin ? `\nSitemap: ${origin}${serverResolver("/sitemap.xml")}\n` : "";

  return new Response(RULES + sitemapLine + LLMS_INDEX, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
