# Wolfsblvt Kener fork

## Meaning

This fork carries Wolfsblvt's small, self-contained patches on top of an exact upstream [Kener](https://github.com/rajnandan1/kener) release, plus build-time vendoring of product brand bundles. Wolf Ops owns it: keeping it current with upstream releases, replaying the patch series, and building the image that Wolf's public and private Kener deployments pin. Wolf granted the fork on 2026-10-25 ([#328](https://github.com/Wolfsblvt/emergency-meeting/issues/328)); the operating boundary is recorded in [`Wolfsblvt/wolf-ops` `AGENTS.md`](https://github.com/Wolfsblvt/wolf-ops/blob/main/AGENTS.md#additional-mutable-repository-wolfsblvtkener).

Everything else about Kener, including its own docs and agent instructions, is upstream's.

## Branches

| Branch | Holds |
| --- | --- |
| `main` | An untouched mirror of upstream `main`. Never commit here. |
| `wolf/v<upstream version>` | The exact upstream release cut plus this fork's patch series, one commit per patch. The GitHub default branch points at the current qualified cut. |

The previous release branch stays reachable after an upgrade so the deployed image's source and rollback coordinate remain recoverable.

## Patch series (current target: `wolf/v4.1.9` on upstream `4.1.9`)

Replay these patches in order:

| Patch | Files | What it changes |
| --- | --- | --- |
| Fork contract | `wolf/`, `AGENTS.md` (fork section) | This document and the agent entry. |
| Role-aware group rollup | `src/lib/server/services/groupCall.ts`, `src/lib/server/services/statusFreshness.ts`, `src/lib/server/queues/monitorExecuteQueue.ts`, `src/lib/server/types/monitor.ts`, `MonitorTypeCard.svelte` (group editor), `monitor-group.svelte`, `docs/content/v4/monitors/group.md` | Group members may carry `role: "required" \| "supporting"`. Then every configured member counts, and a member without a current result (none, `NO_DATA`, or older than its previous scheduled run) is unknown. All unknown is `NO_DATA`; all down is `DOWN`; a required member down is `DOWN`; a required member unknown is `NO_DATA`, never green and never an invented outage; all or required maintenance is `MAINTENANCE`; any other non-up member, including an unknown supporting one, degrades it. A group's default status does not replace that `NO_DATA`. Groups without roles keep upstream's weighted score unchanged. Roles are set through the API; the group editor keeps them when it saves, and the docs and editor help describe the rollup. |
| Truthful page summary and badges | `src/lib/server/controllers/dashboardController.ts`, `src/lib/server/controllers/monitorsController.ts`, `src/routes/(kener)/badge/[tag]/dot/+server.ts`, `src/lib/server/services/statusFreshness.ts`, `src/lib/global-constants.ts`, `src/lib/locales/en.json`, `docs/content/v4/sharing.md` | The page banner counts a monitor without a current result as unknown, never as up. Known-up plus unknown reads "Some Statuses Unavailable" instead of "All Systems Operational". The status and dot badges, single-monitor and `_` all-monitors, apply the same rule: a missing, `NO_DATA` or not-current result shows as no data, and a mixed `_` status reads "Some Statuses Unavailable". Known outages and maintenance still show. Uptime and latency badges and every response shape are unchanged. |
| Inline group expansion | `src/lib/components/GroupMonitorPopover.svelte`, `MonitorBar.svelte`, `MonitorOverview.svelte`, `src/lib/server/controllers/dashboardController.ts` | "Included Monitors (n)" becomes a disclosure button (`aria-expanded`, `aria-controls`) that expands members inline instead of in a drawer, and its accessible name starts with the group name. Member groups expand the same way, so page data carries nested group membership. Members load on first open. `GroupMonitorPopover.svelte.test.ts` covers the disclosure and keyboard behavior. |
| Theme-aware history bars | `src/lib/components/StatusBarCalendar.svelte`, `MinuteGrid.svelte` | The history calendar and the per-minute grid use `colorsDark` in dark mode; the calendar takes the no-data colour from the theme's `--muted`. |
| Admitted public origins | `src/lib/server/publicOrigins.ts`, `src/lib/server/brandBundles.ts`, `src/hooks.server.ts`, `src/app.d.ts`, `src/lib/server/types/api-server.ts`, `layoutController.ts`, `pagesController.ts`, `dashboardController.ts`, `rss.ts`, `incidentController.ts`, `maintenanceController.ts`, `notification/types.ts`, `events-by-month/post.ts`, `subscription/post.ts`, `KenerNav.svelte`, the `(kener)` and `(embed)` layouts, the `(kener)` root, `[page_path]`, page events, feed, sitemap, `robots.txt` (replaces `static/robots.txt`), monitor, badge, incident, maintenance and `dashboard-apis` routes, the monitor, latency and live-events embeds, `docs/content/v4/setup/environment-variables.md`, `monitors/visibility.md`, `rss-feed.md` | `KENER_PUBLIC_ORIGINS=<origin>=<page>,...` lets one instance serve a page as the home of its own domain. Only an exact `Host` header match admits a request; forwarding headers are never read, and any other host behaves as upstream with the site URL. On an admitted origin `/`, `/events/...` and `/rss.xml` are that page's, `/<page>...` answers `308` to the root path, other pages `404`, and the switcher is hidden. The page's title, logo and meta lead the shell, feed and page titles, and its favicon comes from the brand bundle its logo is served from; the site's footer and nav links stay as the secondary relationship. Monitor, feed, badge and embed routes answer only for monitors the page shows (group members included), incidents and maintenances only when global or on those monitors; other content gets a `307` to the site URL's same path, never a host from the request. Subscribing is hidden and refused there, because a subscription covers every page. CSRF compares a form's `Origin` with the admitted origin, scheme and port included. Feed, sitemap, `robots.txt` and social-preview links use the origin; the page's routes name it canonical on both hosts, and `robots.txt` no longer names upstream's `kener.ing` sitemap. Subscriber mail links to the admitted origin whose page shows all of the event's monitors, otherwise to the site URL. The origin lives in request `locals`, never in shared state. On every host, a page's own event lists (inline events, the notifications list, its events page and its feed) cover the same shown monitors, active and visible group members included, so an incident reached through a group member is listed where its group is shown; the group stays one entry. `publicOrigins.test.ts`, `brandBundles.test.ts`, `pagesController.test.ts`, `hooks.server.test.ts` and `(kener)/public-origins.test.ts` cover it. The bundle manifests are read through Vite's `import.meta.glob`, so they live in `brandBundles.ts`, which only Vite-built code imports; `schedulerBundle.test.ts` fails if the esbuild-bundled production entry reaches any `import.meta.glob`, which would stop the server at startup. |
| Host-aware status shell | `layoutController.ts`, `manage/app/site-configurations/+page.svelte`, `brandBundles.ts`, `pagesController.ts`, `dashboardController.ts`, `clientTools.ts`, `types/site.ts`, `KenerNav.svelte`, `IncidentItem.svelte`, `MaintenanceItem.svelte`, the `(kener)` layout, root and `[page_path]` pages and both events routes, `docs/content/v4/setup/site-configuration.md`, `environment-variables.md`, `monitors/group.md` | A site `nav` item may carry `page`: it shows only on that page's admitted origin and never on the site URL, and an origin without items of its own keeps the site's. The dashboard's navigation editor keeps `page` when it saves. A logo that is a vendored bundle's wordmark or lockup is shown at its own proportions, named to assistive technology by the bundle's `displayName`, with a quiet "status" descriptor instead of the site or page name. On a page, an incident or maintenance chip names a group member with the groups leading to it from the page's own rows ("Lens Studio › Analysis API"); a page row, a monitor's own page and embeds keep the plain name. `<main>` carries `data-status-page` (the page path, `""` for home) as a stable hook for per-product presentation, and the page logo has a class and the page title as its alt text instead of "Page Logo". `pagesController.test.ts`, `layoutController.test.ts`, `brandBundles.test.ts` and `clientTools.test.ts` cover it. |
| Readable current state and event accounts | `MonitorBar.svelte`, `IncidentItem.svelte`, `MaintenanceItem.svelte`, `NotificationsList.svelte`, `PageSelector.svelte`, `PageSelector.svelte.test.ts`, both status Home routes, `pagesController.ts`, English mappings and user docs | Current-state words accompany the icon; historical uptime names its period and Unknown says "No uptime data". Ordinary title words wrap without `break-all`. The page switch keeps its visible current-page label at narrow widths. Its native page links are menu items, so arrow keys move among choices and Enter activates one; Tab leaves for the next shell control, Escape closes and returns focus to the trigger. The component test covers this keyboard contract. Status-page event rails omit events already presented inline at every width, while keeping unique history and the events-page link. Existing source-owned private `section-*` navigation groups do not enter compact event chips; the nearest `capability-*` group supplies their context. Public product and other group context remains at every depth; full monitor disclosures are unchanged. No API or schema shape changes. |
| Product brand bundles | `wolf/brand/`, `vendor/brand/`, `Dockerfile`, `.gitattributes` | See below. |

Each patch is independent except that inline expansion reuses upstream's member rendering. All are candidates for upstream contribution; offering one upstream is a separate decision.

## Upgrade an upstream release

1. Resolve the exact upstream release or security-fix commit and update the untouched `main` mirror.
2. Create `wolf/v<version>` at that exact cut.
3. Replay the patch series above in order, preserving source authorship.
4. Resolve conflicts inside the patch that owns the behavior. Record any changed upstream seam in the commit message or this document.
5. Currentize only versioned examples, the current branch statement and the disposable image tag.
6. Run the brand byte check and its test (`node --test wolf/brand/pull.test.mjs`), `npm run check`, and `npm test` with the release's supported Node version. The group, page and badge status tests read the database; also run `currentStatus`, `dashboardController` and `groupCall` tests on PostgreSQL and MariaDB with `TEST_DATABASE_URL` and `--no-file-parallelism`, following the Database section of `CODING_STANDARDS.md`.
7. Build and smoke one disposable local image. Do not publish it merely to prove the source builds.
8. Compare the final branch against the exact upstream cut. The only delta should be the maintained patch series and current fork documentation.
9. Move the repository default branch only after qualification. Retain the previous `wolf/v...` branch.
10. Changing either deployed Kener digest is a separate Wolf Ops operation with its own backup, migration, readback and rollback evidence.

This is deliberately a bounded replay, not an accumulating merge branch and not an excuse to make Wolf run an upgrade ritual.

## Product brand bundles

Product identities come byte for byte from each product's own repository, following the Leitsatz Brand Bundle Contract. This fork never edits or redraws them.

- [`brand/pins.json`](brand/pins.json) names each bundle's owning repository, exact carrier commit, and the `bundleSha256` of the bundle at that commit.
- `node wolf/brand/pull.mjs` fetches `brand/bundle/<id>/` at each pin into `vendor/brand/<id>/`, validates it with the shared validator (vendored from `Wolfsblvt/wolf-leitsatz@c82a6426a7f793f7cf9968f2390c282945c1c659`, `packages/leitsatz-core/source/skills/brand-assets/`), and records the fetched `bundleSha256` in the pin.
- The image build runs `node wolf/brand/pull.mjs --check`, which validates the committed bundle and fails unless its `bundleSha256` is the one recorded in the pin. A bundle edited outside its owning repository fails even when its own hashes agree. The build then copies `vendor/brand` into `static/brand`. Kener serves the bundles same-origin at `/brand/<id>/...`.
- `.gitattributes` keeps `vendor/brand/**` byte-exact.

To adopt a new identity version, update the pin's commit, run the pull, review the diff (bundle and recorded `bundleSha256`) and commit. `node --test wolf/brand/pull.test.mjs` proves the check refuses a self-consistent bundle that is not the pinned one. To add a product, add its pin; its repository must already export a bundle.

## Verify and build

Kener 4.1.9 requires Node 24.14 or later. Without a matching local Node, run the suite in a container, keeping `node_modules` in a volume:

```sh
docker run --rm --ipc=host -v "$PWD:/app" -v kener-fork-node-modules-pw:/app/node_modules -w /app \
  mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run check && npm test"
```

The suite does not start the production server. Its entry (`scripts/main.ts`) is bundled by esbuild rather than Vite, so after `npm run build` start `node build/main.js` once with `REDIS_URL` set and read `/healthcheck`; `schedulerBundle.test.ts` guards the one failure seen so far, Vite-only `import.meta.glob`.

Build the image the same way upstream's plain release is built (Debian variant, docs off):

```sh
docker build --build-arg VARIANT=debian --build-arg WITH_DOCS=false -t kener-wolf:v4.1.9-wolf.1 .
```

Actions are disabled on this fork until Wolf authorizes a workflow. Publishing an image and changing a deployed digest belong to Wolf Ops' deployment route, not to this repository.
