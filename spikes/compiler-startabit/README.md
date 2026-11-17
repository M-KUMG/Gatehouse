# startabit tools verification scripts (reference only)

Scripts from the verification of https://github.com/startabit/avr-gcc-wasm release v1 against our
spike pipeline (see `docs/compiler-spike-startabit.md`). Not part of the app, not built or tested.
Paths point at the original scratch folder; the downloaded wasm tools are NOT stored here
(download them from the release and check them against its SHA256SUMS).
`build-sb.mjs` builds the test sketches with the startabit tools, `cmp-sb.mjs`/`cmp-horang.mjs`
compare results, `emu-results-sb.json` is what ran in our emulator, `release.json`/`repo.json` are
GitHub API snapshots (assets, licence) taken on 2026-11-17.
