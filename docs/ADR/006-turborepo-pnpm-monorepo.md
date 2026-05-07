# ADR 006 — Turborepo + pnpm Workspaces Monorepo

**Status**: Accepted  
**Date**: 2026-05-07

## Context

The platform has 3 deployable apps and 4 shared packages that must be built, tested, and deployed independently but share code. Options: npm/yarn workspaces + Lerna, Nx, Turborepo + pnpm.

## Decision

Use **Turborepo** for task orchestration with **pnpm workspaces** for package management.

## Rationale

**Turborepo remote caching**: After the first CI run, unchanged packages are restored from cache. CI build time drops from ~8 minutes to ~90 seconds for most PRs.

**pnpm efficiency**: Content-addressable store + hard links — `node_modules` is 60% smaller than npm. Strict dependency isolation (packages can only import what they declare).

**Incremental builds**: Turborepo hashes inputs (source files + tsconfig) and skips tasks with matching outputs. The `tsc --incremental` flag combines with this for near-instant TypeScript rebuilds on change.

**Simplicity**: Turborepo requires only `turbo.json` — no complex plugin system like Nx. `pnpm-workspace.yaml` is 3 lines.

**Workspace protocol**: `"@ecom/shared": "workspace:*"` means the local package is always used — no publishing to npm required.

## Consequences

- All cross-package imports use the package name (`import from '@ecom/shared'`), not relative paths.
- Package `build` tasks must declare `dependsOn: ["^build"]` so dependencies build first.
- Lambda deploy scripts build each `apps/*` independently with esbuild (Turborepo handles the ordering).
- Remote caching uses Vercel's free Turborepo cache in CI (or self-hosted via `TURBO_TEAM`/`TURBO_TOKEN`).
