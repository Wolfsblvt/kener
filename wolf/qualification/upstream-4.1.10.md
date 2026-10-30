# Upstream 4.1.10 source qualification

## Meaning

This record preserves the original proposal-era comparison, replay and qualification evidence for Kener 4.1.10, then records adoption of accepted source `23b18004177a3c60bd21f7e2cfef9546c8fe1152` as `wolf/v4.1.10`, the current upstream-main mirror, the GitHub default change and a fresh local Debian/docs-off image qualification. It keeps the authentication repair receipt and earlier image evidence bound to their exact cuts. It does not establish hosted CI, publication, deployed image state, real authentication configuration or operating adoption.

## Exact source and compatibility

The accepted source is `4afd0866378fb57cc7415cbdac41e85edc6c1665`, tree `f69e0bab50f9fb17431a371fe328ec9c1f0baf3c`, on `wolf/v4.1.9`. Its upstream cut is `a91998781f15812adc6422ed05b0580b6f38d3b5` (`v4.1.9`). The [upstream 4.1.10 release](https://github.com/rajnandan1/kener/releases/tag/v4.1.10) has annotated tag object `d491d481423b9d51dd63a5e7cb652f976a9255a2`, peeling to `68a6ea236ced714b081f0cac7f1d86383f3ef427`.

All 35 accepted fork commits replay without conflicts. The replayed implementation cut is `1e263c49b6c6551b1520d05445a79ac20de020d7`, tree `fd6646bacd7104fd50af3d60f552743411b1a08a`. `git range-diff` marks every original/replayed pair `=`. Before the proposal's documentation update, the effective difference from the accepted fork is exactly upstream's 15-file delta (214 insertions, 167 deletions). No fork implementation, migration, dependency selection, API shape, brand pin or vendored byte changes in the replay.

Upstream removes the hardcoded authentication-secret fallback from session/link signing, token verification and API-key HMAC. An unset or empty `KENER_SECRET_KEY` now disables these authentication paths, and the setup check rejects an empty key. Startup warns for missing keys and known published examples. Published examples still work as configured keys; the warning does not enforce key quality. A configured, unchanged non-example key retains existing session signatures and API-key hashes. Changing the key signs users out and invalidates existing API keys. Source qualification neither reads real configuration nor recommends an unexamined rotation.

The upstream change also corrects authentication documentation, adds secret-handling regressions, sets a synthetic server-test key and increments package metadata. The fork's added environment-variable documentation and full-suite browser configuration compose without conflict. Hierarchy/order, Unknown/currentness, explicit observations, history/association/retirement, incident/cache behavior, host-specific public presentation and confinement retain their accepted implementations. Brand pins and bundles remain byte-identical to the accepted source.

## Qualification

The executable cut above is immutable. The proposal adds only this record, fork-documentation currentization and a `/artifacts/` ignore entry beyond that cut; those changes do not alter the tested implementation.

| Boundary                                | Actual result                                                                                                                                                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete maintained suite, Node 24.17.0 | `npm run check`: zero errors and warnings. `npm test -- --no-file-parallelism`: 68 files / 759 tests pass, including Chromium component tests and upstream authentication regressions.                                                                                           |
| Brand bytes                             | Both offline pin checks pass; all four `node --test wolf/brand/pull.test.mjs` cases pass. Pins and vendored files are unchanged.                                                                                                                                                 |
| PostgreSQL 16.15                        | Native migrations and six seeds pass. Current-status, dashboard, group and explicit-observation tests pass 56 cases; API/dashboard write parity passes 37 cases, serially.                                                                                                       |
| MariaDB 11.8.9                          | The same native migrations/seeds and 93 cases pass.                                                                                                                                                                                                                              |
| Debian image, docs disabled             | The maintained Dockerfile builds successfully, including the SvelteKit application and esbuild production entry, then prunes development dependencies. Runtime Node is 24.22.2. Local image identity: `sha256:da5244eddae95f669d7a8b803114215976fd20b9d2379049034cf60b08b66e7b`. |
| Packaged runtime with Redis             | 17 real HTTP assertions pass on each of SQLite, PostgreSQL and MariaDB: strict health, anonymous API refusal, configured-key acceptance, page creation, admitted product Home/canonical/308 behavior, enabled sitemap discovery and both bundled brand manifests.                |
| Packaged runtime without a key          | Six assertions pass: strict health remains available, anonymous access is refused, a stored API-key hash made with the old fallback cannot authenticate (HTTP 500), and sign-in shows setup incomplete. The startup warning is observed on stderr.                               |
| Shutdown                                | Every tested application container logs completed graceful shutdown and exits zero.                                                                                                                                                                                              |

The test databases are disposable and separate by migration-name convention. Native CLI migrations and the write-parity fixture record bare filenames; the other Vite fixtures record `/migrations/...` names. Combining those sources in one database causes Knex's migration-list validation to refuse it. Initial mixed-fixture attempts demonstrated this mismatch; separate native/write-parity and Vite-reader databases pass without a product or test-source patch.

The HTTP fixture uses native HTTP requests: a bounded echo-server comparison established that Node's `fetch` ignores a supplied `Host`, whereas native HTTP sends the exact header. The fixture explicitly enables sitemap generation, which fresh seed data disables. The log collector captures both stdout and stderr so the missing-key warning is actually observed. These are qualification corrections, not changes to Kener.

The source archive used for the suite and image is SHA-256 `48f05fbeb3d8834336b983f3a2c45e4c5529c006ee4f94bf533a9105c1cd2fa1`. Runtime fixtures use an internal-only Docker network, synthetic keys and data, without published host ports or external provider access. The disposable image, containers, anonymous database/Redis volumes and networks are retired after qualification; build caches are not pruned. Build diagnostics remain evidence rather than a clean-diagnostics claim.

At the time this proposal qualification was recorded, hosted Actions were disabled, the separate release/default/mirror adoption remained unperformed, and draft PR6 was only a comparison carrier against `wolf/v4.1.9`. GitHub's merge-base diff includes the replayed series; `git diff 4afd0866378fb57cc7415cbdac41e85edc6c1665 <proposal-head>` gives the effective upgrade delta, and the table below accounts for the upstream-to-proposal series.

## Replay account

The following original and replayed commits retain their complete messages and material source attribution. Replay mechanics do not add an author. The proposal's new documentation is attributed separately.

| Accepted 4.1.9 commit                      | Replayed 4.1.10 commit                     |
| ------------------------------------------ | ------------------------------------------ |
| `f73f0ff895f09fde73a4ddfa95d55786a3b12ac8` | `a02d7be8477faa16817eee832f96dfd3e448d98e` |
| `442254bb08edbd48d88e292cd6c56560772ad9e2` | `8b72c999242f4cb15110ed36030294ff60acefb8` |
| `c26e11458d932b026fac2b97fe80adb1ef0a8003` | `aea79074aa53c4fea60edf494d80113ce500fab0` |
| `4bd43cd1d2ed33f90a3f9f4bd8bfca3940b1c9a2` | `bae6076ec95b2102567df8fd5c9444e724562721` |
| `d5a163a02edd4a2ac001af9ecf3ac7c37dbbefeb` | `46377a5fa3a50b43f31d934318084fb2617d1108` |
| `b9afa96f988cad8156b3c5f8e8a715802a7ba55f` | `221a22bde41c9c1f5fedc78dc62cfa402a9e2111` |
| `bd2882e915fc3d25960358d81d4af504e0654014` | `e3a3ae36e891eb58852e68c1eaddb5261521e1ef` |
| `ab69231d0ac1eaf03ea15fa1acb51fad7629a283` | `ffb7190796eac42c995ab166b139a3202b9bfb12` |
| `3fff52e0726e5048f16b4a9195f83ef7c836122f` | `3f49adfd9dc4e48d156b3c7bed127c8f81ec004f` |
| `11450e965bc241c8a227e361b51f96056ef4d317` | `5b526a75e67af532e8852df07e0de47c8ed70e05` |
| `22141fb500cacdae049963b35321ee3b15571680` | `5a33565641691757cf0dac9bfd0577420575b822` |
| `4d631c82761420cc8b4ee8089f45ddc9be2be0ff` | `9a70eb88b288d6dd09861df0db4ffa4f1c323074` |
| `ce994f35e91c091715d508d1ce87dbf3c02d5144` | `e67614acbf37e5e677d6df2465b4e05e57e28218` |
| `45602b36ecdb968214b7614dd4a1a79969afd33f` | `b1f93dba262f9e6be3d10e97b7f05bcaeb44f1da` |
| `292452cf8cc8bdebf6d2d0d63c9f079ce4627419` | `0d0f15ba038e069852626c6eaa16fa10fda32b63` |
| `ff6065692f5d4e6ab48a652e7201fc45e61eaccf` | `c65dd39496efc6d2de8a2d51ee11e63f61d3642e` |
| `5a4f4dcac937d3ae1a26ca2fe7e3c9b6e28199b6` | `ef46f2df00c4314326279ac79177cc62c07ec399` |
| `9c4e846500f16295e40c1c81cd436d78293012c3` | `9d890b5a4eeddf9fbb1a881462001ef4610259fd` |
| `8e3d79fb7df02c63fe065c735031107b28dcf070` | `3165116942ea978bb241af7df5bc85c8a58d31f5` |
| `e6493568a6e17766c16349ae61b91b19927b686d` | `b30aacc157c3f06ab7c3fd2b7a72212efe141c39` |
| `a4785a067cae617abc776997c011d89ad309972b` | `27a6d6a1f520e7681ac1576f76b8ffe0763e05e2` |
| `31787d9fa76cfbe5477fe557c939a8b6eb4e7c37` | `c515d661596ec22615a29498d2d484df7c88bad7` |
| `4e22acd95bd75a1db80e30ed69bc7e28c55520e0` | `5f9c0d6b541c45fa635e0ecfc1df53e78c5875ca` |
| `1d9869bf476c9aa844e006c790135cf100c79105` | `b79b37913cc1181dfc4294066b394f7da3e22879` |
| `271b1e79fa81f6b48df9918ad38fa21918619942` | `b79ebc647d8c0cc47a9dd673866094e1df83d457` |
| `0c1fd28256e71afa79aa1eba11e7e0ebdad22473` | `206bd380d17a594c3a11297dac5e9bc2f3633769` |
| `5abc7300f35878ba6ab9317f7b160e391efbd59c` | `0ed669609aa64acb704d06bd6f14115de21687ab` |
| `cf5e8de83ad65ca12f7aa1bc95f6780c20a0f157` | `dcd786651e4c8df0c7c926a0725e47dd1b2886ae` |
| `3ff1de0ec9535970483f676d3c011f434008e8d6` | `fda65a071198f90462238ce42b46b3d1333a11cb` |
| `60e69af2494864b90bde6dbd506574df85e7cea5` | `a28eab49be8e168a28bd24434c7e6502f02141eb` |
| `d72e83e9494dfcbbc62112f42babd20243617238` | `8690f06bdd6d820f52fb46dd156d0c5930e513d1` |
| `36f1f7aa0a9692f3127fb87e6e4e065b0b20781e` | `64cb4645aea3c787151f74a938c62c6d608509f6` |
| `adbb254e5a75495941e1acfaac57a10985a8832f` | `9e7dc54e522dd791f8ff29d337d60225afa9c588` |
| `5a1b5e545e1ecedf0880a7b96d08ff6e8b34a0fb` | `095961ebbeda9701a248f176325afaadb50c5347` |
| `4afd0866378fb57cc7415cbdac41e85edc6c1665` | `1e263c49b6c6551b1520d05445a79ac20de020d7` |

## Maintained release adoption

On 2026-10-30 the accepted repair source `23b18004177a3c60bd21f7e2cfef9546c8fe1152` (tree `7c5eec14e0d50051b67ecc33e7a933f4cb44f17d`) was retained as `wolf/v4.1.10`, based on exact upstream tag object `d491d481423b9d51dd63a5e7cb652f976a9255a2`, peeling to `68a6ea236ced714b081f0cac7f1d86383f3ef427`. The already accepted authentication qualification receipt `e7035ac5b7aba729c520abb0cbe8f5ea403c6fcb23662f474631117d7e5586e4` binds this repaired source; its 779-test suite, per-engine state cases and compiled-runtime proof were reused without replay.

A fresh local Debian/docs-off image was built from the repaired source as `kener-wolf:v4.1.10-wolf.2`, image ID `sha256:ae30e3ed910bea4acaecdf824c6636a0e70ddb27a98ba6a080fc79aaf28e0acb`. Its packaged runtime reached healthy state with disposable Redis on an internal-only network; `/healthcheck` returned `{"status":"ok","db":true,"redis":true}`. Build output contained circular-dependency warnings. The disposable containers, network and image were removed after the smoke; the build cache was retained. This smoke establishes packaged health only and does not repeat or extend authentication qualification.

The `main` mirror now points to upstream `main` `dc9d9f118d8acb9bbd1e7f743f22d4b0fed90efe`, a descendant of the exact 4.1.10 release cut; it was advanced without rewriting history. GitHub's default branch is `wolf/v4.1.10`. The previous `wolf/v4.1.9` remains at `4afd0866378fb57cc7415cbdac41e85edc6c1665`. PR6 was manually closed without a GitHub merge after adoption readback. Its proposal branch was retired after the exact head became contained in `wolf/v4.1.10`. Hosted Actions are disabled. No package or image was published and no deployment was changed.

Unobserved: real provider or email authentication, actual configured key state or strength, hosted CI, published image identity, deployed digest/configuration, and ordinary use of the full status/recovery product. Those remain outside this source-adoption result.
