# Wolfsblvt Kener fork

## Meaning

This fork carries Wolfsblvt's small, self-contained patches on top of an exact upstream [Kener](https://github.com/rajnandan1/kener) release, plus the build-time vendoring of product brand bundles. Wolf Ops owns it: keeping it current with upstream releases, replaying the patch series, and building the image that Wolf's public and private Kener deployments pin. Wolf granted the fork on 2026-10-25 ([#328](https://github.com/Wolfsblvt/emergency-meeting/issues/328)); the operating boundary is recorded in [`Wolfsblvt/wolf-ops` `AGENTS.md`](https://github.com/Wolfsblvt/wolf-ops/blob/main/AGENTS.md#additional-mutable-repository-wolfsblvtkener).

Everything else about Kener, including its own docs and agent instructions, is upstream's.

## Branches

| Branch | Holds |
| --- | --- |
| `main` | An untouched mirror of upstream `main`. Never commit here. |
| `wolf/v<upstream version>` | The upstream release tag plus this fork's patch series, one commit per patch. The GitHub default branch points at the current one. |

Upgrading to a new upstream release replays the series onto that release's tag as a new `wolf/v<next>` branch. The previous branch stays as it is, so the deployed image's source remains reachable. Resolve conflicts per patch, rerun the tests below, then move the default branch.

## Patch series (current: `wolf/v4.1.4` on upstream `v4.1.4`)

| Patch | Files | What it changes |
| --- | --- | --- |
| Fork contract | `wolf/`, `AGENTS.md` (fork section) | This document and the agent entry. |
| Role-aware group rollup | `src/lib/server/services/groupCall.ts`, `src/lib/server/types/monitor.ts` | Group members may carry `role: "required" \| "supporting"`. A required member down makes the group down, required maintenance makes it maintenance, any other non-up member degrades it; all members down or in maintenance carry through. Groups without roles keep upstream's weighted score unchanged. |
| Inline group expansion | `src/lib/components/GroupMonitorPopover.svelte`, `src/lib/server/controllers/dashboardController.ts` | "Included Monitors (n)" becomes a disclosure button (`aria-expanded`, `aria-controls`) that expands members inline instead of in a drawer. Member groups expand the same way, so page data carries nested group membership. Members load on first open. |
| Theme-aware history bars | `src/lib/components/StatusBarCalendar.svelte` | Bars use `colorsDark` in dark mode (upstream always painted the light set) and take the no-data colour from the theme's `--muted`. |
| Product brand bundles | `wolf/brand/`, `vendor/brand/`, `Dockerfile`, `.gitattributes` | See below. |

Each patch is independent of the others except that inline expansion reuses upstream's member rendering. All are candidates for upstream contribution; offering one upstream is a separate decision.

## Product brand bundles

Product identities come byte for byte from each product's own repository, following the Leitsatz Brand Bundle Contract. This fork never edits or redraws them.

- [`brand/pins.json`](brand/pins.json) names each bundle's owning repository and exact carrier commit.
- `node wolf/brand/pull.mjs` fetches `brand/bundle/<id>/` at each pin into `vendor/brand/<id>/` and validates it with the shared validator (vendored from `Wolfsblvt/wolf-leitsatz@c82a6426a7f793f7cf9968f2390c282945c1c659`, `packages/leitsatz-core/source/skills/brand-assets/`).
- The image build runs `node wolf/brand/pull.mjs --check`, which fails on any changed byte, then copies `vendor/brand` into `static/brand`. Kener serves the bundles same-origin at `/brand/<id>/...`, for example `/brand/works/css/fonts.css` and `/brand/diffdevil/assets/wordmark/on-dark.svg`.
- `.gitattributes` keeps `vendor/brand/**` byte-exact.

To adopt a new identity version, update the pin, run the pull, review the diff and commit. To add a product, add its pin; its repository must already export a bundle.

## Verify and build

Kener requires Node 20–25 (`engine-strict`). Without a matching local Node, run the suite in a container, keeping `node_modules` in a volume:

```sh
docker run --rm --ipc=host -v "$PWD:/app" -v kener-fork-node-modules-pw:/app/node_modules -w /app \
  mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run check && npm test"
```

Build the image the same way upstream's plain release tag is built (Debian variant, docs off):

```sh
docker build --build-arg VARIANT=debian --build-arg WITH_DOCS=false -t kener-wolf:v4.1.4-wolf.1 .
```

Actions are disabled on this fork until Wolf authorizes a workflow. Publishing an image and changing a deployed digest belong to Wolf Ops' deployment route, not to this repository.
