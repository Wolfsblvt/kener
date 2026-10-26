import MobileDetect from "mobile-detect";
import type { Cookies } from "@sveltejs/kit";
import type { UserRecordPublic } from "$lib/server/types/db";
import seedSiteData from "$lib/server/db/seedSiteData";
import {
  CanSeeHiddenMonitors,
  GetAllSiteData,
  GetLoggedInSession,
  GetLocaleFromCookie,
  GetUsersCount,
  HasRequiredEnv,
  IsEmailSetup,
} from "./controller.js";
import type { EventDisplaySettings, GlobalPageVisibilitySettings, SiteDateTimeFormat } from "$lib/types/site.js";
import serverResolve from "../resolver.js";
import { ResolveEventListPlacement } from "$lib/clientTools";
import { AdmittedOriginIdentity, type PublicOrigin } from "../publicOrigins.js";
import { BrandFavicon } from "../brandBundles.js";

export interface LayoutServerData {
  isMobile: boolean;
  isSetupComplete: boolean;
  isAdminAccountCreated: boolean;
  loggedInUser: UserRecordPublic | null;
  canSeeHiddenMonitors: boolean;
  selectedLang: string;
  siteStatusColors: {
    UP: string;
    DOWN: string;
    DEGRADED: string;
    MAINTENANCE: string;
    ACCENT: string;
    ACCENT_FOREGROUND: string;
  };
  siteStatusColorsDark: {
    UP: string;
    DOWN: string;
    DEGRADED: string;
    MAINTENANCE: string;
    ACCENT: string;
    ACCENT_FOREGROUND: string;
  };
  navItems: Array<{ name: string; url: string; iconURL: string }>;
  siteName: string;
  siteUrl: string;
  // True on an admitted public origin, where the page's own identity leads the shell
  isProductHome: boolean;
  logo: string | undefined;
  favicon: string | undefined;
  footerHTML: string;
  isSubsEnabled: boolean;
  languageSetting: {
    defaultLocale: string;
    locales: Array<{ code: string; name: string; selected: boolean; disabled: boolean }>;
  };
  subMenuOptions: {
    showShareBadgeMonitor: boolean;
    showShareEmbedMonitor: boolean;
    showRssFeed: boolean;
  };
  isTimezoneEnabled: boolean;
  isThemeToggleEnabled: boolean;
  defaultSiteTheme: string;
  font: {
    cssSrc: string;
    family: string;
  };
  canSendEmail: boolean;
  announcement?: {
    title: string;
    message: string;
    type: "INFO" | "WARNING" | "ERROR";
    reshowAfterInHours: number | null;
    cancellable: boolean;
    ctaURL: string | null;
    ctaText: string | null;
  };
  eventDisplaySettings: EventDisplaySettings;
  socialPreviewImage?: string;
  customCSS?: string;
  globalPageVisibilitySettings: GlobalPageVisibilitySettings;
  dateAndTimeFormat: SiteDateTimeFormat;
  metaSiteTitle?: string;
  metaSiteDescription?: string;
}

function NormalizeEventDisplaySettings(settings?: Partial<EventDisplaySettings>): EventDisplaySettings {
  const defaults = structuredClone(seedSiteData.eventDisplaySettings);

  return {
    showInlineEvents:
      typeof settings?.showInlineEvents === "boolean" ? settings.showInlineEvents : defaults.showInlineEvents,
    eventListPlacement: ResolveEventListPlacement(settings),
    incidents: {
      ...defaults.incidents,
      ...settings?.incidents,
      ongoing: {
        ...defaults.incidents.ongoing,
        ...settings?.incidents?.ongoing,
      },
      resolved: {
        ...defaults.incidents.resolved,
        ...settings?.incidents?.resolved,
      },
    },
    maintenances: {
      ...defaults.maintenances,
      ...settings?.maintenances,
      ongoing: {
        ...defaults.maintenances.ongoing,
        ...settings?.maintenances?.ongoing,
      },
      past: {
        ...defaults.maintenances.past,
        ...settings?.maintenances?.past,
      },
      upcoming: {
        ...defaults.maintenances.upcoming,
        ...settings?.maintenances?.upcoming,
      },
    },
  };
}

// publicOrigin: the admitted origin this request arrived on, if any. Its absolute links use that origin,
// its one page is exclusive (no page switcher; "/" and the page's links stay on that page), the page's
// title, logo, brand favicon and meta lead instead of the site's, and subscribing stays on the site URL.
export async function GetLayoutServerData(
  cookies: Cookies,
  request: Request,
  publicOrigin: PublicOrigin | null = null,
): Promise<LayoutServerData> {
  const userAgent = request.headers.get("user-agent") ?? "";
  const md = new MobileDetect(userAgent);
  const isMobile = !!md.mobile();

  const [loggedInUser, siteData, userCounts, productIdentity] = await Promise.all([
    GetLoggedInSession(cookies),
    GetAllSiteData(),
    GetUsersCount(),
    publicOrigin ? AdmittedOriginIdentity(publicOrigin) : null,
  ]);
  const canSeeHiddenMonitors = await CanSeeHiddenMonitors(loggedInUser);

  // Same check as IsSetupComplete, but reuses the site data fetched above
  // instead of querying it a second time on every request
  const isSetupComplete = HasRequiredEnv() && Object.keys(siteData).length > 0;

  const selectedLang = GetLocaleFromCookie(siteData, cookies);
  const siteStatusColors = siteData.colors;

  const siteStatusColorsDark = siteData.colorsDark || siteStatusColors;

  // Check if subscription is enabled
  // Subscriptions cover every page, so they are offered on the site URL only, never on an admitted origin
  let isSubsEnabled = false;
  const subsSetting = siteData.subscriptionsSettings;
  if (
    !publicOrigin &&
    subsSetting &&
    subsSetting.enable &&
    (subsSetting.methods.emails.incidents || subsSetting.methods.emails.maintenance)
  ) {
    isSubsEnabled = true;
  }

  const languageSetting = {
    ...(siteData.i18n || seedSiteData.i18n),
    locales: (siteData.i18n?.locales || seedSiteData.i18n.locales).filter((l) => l.selected).map((l) => ({ ...l })),
  };
  const isTimezoneEnabled = !!siteData.tzToggle && siteData.tzToggle !== "NO";
  const isThemeToggleEnabled = !!siteData.themeToggle && siteData.themeToggle !== "NO";
  const defaultSiteTheme = siteData.theme || "system";
  const font = siteData.font || { cssSrc: "", family: "" };
  const canSendEmail = IsEmailSetup();
  const globalPageVisibilitySettings =
    siteData.globalPageVisibilitySettings || seedSiteData.globalPageVisibilitySettings;
  const favicon = productIdentity ? BrandFavicon(productIdentity.logo) : siteData.favicon;
  return {
    isMobile,
    isSetupComplete,
    isAdminAccountCreated: userCounts ? Number(userCounts.count) > 0 : false,
    loggedInUser,
    canSeeHiddenMonitors,
    selectedLang,
    siteStatusColors,
    siteStatusColorsDark,
    navItems: siteData.nav || [],
    siteName: productIdentity?.name || siteData.siteName || "Kener",
    siteUrl: publicOrigin?.origin ?? (siteData.siteURL || ""),
    isProductHome: !!productIdentity,
    logo: productIdentity ? productIdentity.logo : siteData.logo,
    // Browsers fetch <link rel="icon"> from the SSR HTML before hydration.
    // SvelteKit's resolve() uses a relative base on the app-root page, so
    // prefix KENER_BASE_PATH here instead of in the layout.
    favicon: favicon ? serverResolve(favicon) : favicon,
    footerHTML: siteData.footerHTML || "",
    isSubsEnabled,
    languageSetting,
    subMenuOptions: siteData.subMenuOptions || seedSiteData.subMenuOptions,
    isTimezoneEnabled,
    isThemeToggleEnabled,
    defaultSiteTheme,
    font,
    canSendEmail,
    announcement: siteData.announcement,
    eventDisplaySettings: NormalizeEventDisplaySettings(siteData.eventDisplaySettings),
    socialPreviewImage: productIdentity ? productIdentity.socialPreviewImage : siteData.socialPreviewImage,
    customCSS: siteData.customCSS,
    globalPageVisibilitySettings: publicOrigin
      ? { ...globalPageVisibilitySettings, showSwitcher: false, forceExclusivity: true }
      : globalPageVisibilitySettings,
    dateAndTimeFormat: siteData.dateAndTimeFormat || seedSiteData.dateAndTimeFormat,
    metaSiteTitle: productIdentity ? productIdentity.metaTitle : siteData.metaSiteTitle,
    metaSiteDescription: productIdentity ? productIdentity.metaDescription : siteData.metaSiteDescription,
  };
}
