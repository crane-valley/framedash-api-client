# Changelog

All notable changes to `@framedash/api-client` are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-06-30

### Added

- `buildBuildsPath` gains optional `fresh` (bypass the server aggregation cache
  for a live read) and `buildId` (scope the list to one build) params; used by
  the `framedash run-profile-test` CI ingest wait.
- `buildBuildComparePath` gains an optional `fresh` param (bypass the comparison
  cache) for the CI gate.

## [0.1.1] - 2026-06-07

Published from the public mirror via npm Trusted Publishing (OIDC) with a
provenance attestation; the published manifest now carries repository metadata.
No API changes.

## [0.1.0] - 2026-06-06

Initial public pre-release (beta).

- Typed HTTP client for the Framedash analytics API; the shared dependency of
  `@framedash/cli` and `@framedash/mcp-server`.
