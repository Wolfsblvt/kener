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
| Role-aware group rollup | `src/lib/server/services/groupCall.ts`, `src/lib/server/types/monitor.ts` | Group members may carry `role: "required" \| "supporting"`. A required member down makes the group down, required maintenance makes it maintenance, any other non-up member degrades it; all members down or in maintenance carry through. Groups without roles keep upstream's weighted score unchanged. |
| Inline group expansion | `src/lib/components/GroupMonitorPopover.svelte`, `src/lib/server/controllers/dashboardController.ts` | "Included Monitors (n)" becomes a disclosure button (`aria-expanded`, `aria-controls`) that expands members inline instead of in a drawer. Member groups expand the same way, so page data carries nested group membership. Members load on first open. |
| Theme-aware history bars | `src/lib/components/StatusBarCalendar.svelte` | Bars use `colorsDark` in dark mode and take the no-data colour from the theme's `--muted`. |
| Product brand bundles | `wolf/brand/`, `vendor/brand/`, `Dockerfile`, `.gitattributes` | See below. |

Each patch is independent except that inline expansion reuses upstream's member rendering. All are candidates for upstream contribution; offering one upstream is a separate decision.

## Upgrade an upstream release

1. Resolve the exact upstream release or security-fix commit and update the untouched `main` mirror.
2. Create `wolf/v<version>` at that exact cut.
3. Replay the patch series above in order, preserving source authorship.
4. Resolve conflicts inside the patch that owns the behavior. Record any changed upstream seam in the commit message or this document.
5. Currentize only versioned examples, the current branch statement and the disposable image tag.
6. Run the brand byte check, `npm run check`, and `npm test` with the release's supported Node version.
7. Build and smoke one disposable local image. Do not publish it merely to prove the source builds.
8. Compare the final branch against the exact upstream cut. The only delta should be the maintained patch series and current fork documentation.
9. Move the repository default branch only after qualification. Retain the previous `wolf/v...` branch.
10. Changing either deployed Kener digest is a separate Wolf Ops operation with its own backup, migration, readback and rollback evidence.

This is deliberately a bounded replay, not an accumulating merge branch and not an excuse to make Wolf run an upgrade ritual.

## Product brand bundles

Product identities come byte for byte from each product's own repository, following the Leitsatz Brand Bundle Contract. This fork never edits or redraws them.

- [`brand/pins.json`](brand/pins.json) names each bundle's owning repository and exact carrier commit.
- `node wolf/brand/pull.mjs` fetches `brand/bundle/<id>/` at each pin into `vendor/brand/<id>/` and validates it with the shared validator (vendored from `Wolfsblvt/wolf-leitsatz@c82a6426a7f793f7cf9968f2390c282945c1c659`, `packages/leitsatz-core/source/skills/brand-assets/`).
- The image build runs `node wolf/brand/pull.mjs --check`, which fails on any changed byte, then copies `vendor/brand` into `static/brand`. Kener serves the bundles same-origin at `/brand/<id>/...`.
- `.gitattributes` keeps `vendor/brand/**` byte-exact.

To adopt a new identity version, update the pin, run the pull, review the diff and commit. To add a product, add its pin; its repository must already export a bundle.

## Verify and build

Kener 4.1.9 requires Node 24.14 or later. Without a matching local Node, run the suite in a container, keeping `node_modules` in a volume:

```sh
docker run --rm --ipc=host -v "$PWD:/app" -v kener-fork-node-modules-pw:/app/node_modules -w /app \
  mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci && npm run check && npm test"
```

Build the image the same way upstream's plain release is built (Debian variant, docs off):

```sh
docker build --build-arg VARIANT=debian --build-arg WITH_DOCS=false -t kener-wolf:v4.1.9-wolf.1 .
```

Actions are disabled on this fork until Wolf authorizes a workflow. Publishing an image and changing a deployed digest belong to Wolf Ops' deployment route, not to this repository.
