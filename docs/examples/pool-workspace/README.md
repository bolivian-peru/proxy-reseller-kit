# Pool workspace model fixture

Host-owned reference code for [the build guide](../../POOL-PROXY-WORKSPACE.md).
It is not shipped as an SDK export and is not a complete application.

`model.ts` imports the repository's actual SDK builder/types. Production hosts
import them from `@proxies-sx/pool-sdk`, add their existing authentication and UI,
allocate stable owned SIDs, and use customer-scoped browser storage. No reseller
API key or plaintext proxy password belongs in saved lists. These tests use
placeholder credentials only and make no network requests.

Run from the repository root with the installed TypeScript compiler:

```sh
fixture_dir=$(mktemp -d)
# Use the repo's existing TypeScript binary; no package installation is required.
pnpm --filter @proxies-sx/pool-sdk exec tsc ../../docs/examples/pool-workspace/model.ts --target ES2022 \
  --module commonjs --moduleResolution node --strict --skipLibCheck \
  --rootDir ../.. --outDir "$fixture_dir"
POOL_WORKSPACE_COMPILED="$fixture_dir" node --test docs/examples/pool-workspace/model.test.cjs
# Remove only the temporary directory created for this fixture when finished.
```

An empty browser store is distinct from corrupt storage. Catch the latter and
show a recoverable local-save error. The helper does not test live stock,
protocol delivery, provider mutation safety or an authenticated rendered page.
Those acceptance steps belong to the host application.
