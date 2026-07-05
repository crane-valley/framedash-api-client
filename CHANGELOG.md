# Changelog

All notable changes to `@framedash/api-client` are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.3] - 2026-07-05

### Added

- OAuth Bearer token support: `ApiClientOptions` now accepts exactly one
  credential -- `apiKey` (sent as `X-API-Key`, as before) or the new
  `accessToken` (sent as `Authorization: Bearer`) -- expressed by the exported
  `ApiClientCredential` union type. Passing both or neither is a compile-time
  error and a runtime constructor error; `withProject()` preserves whichever
  credential the client was built with. Used by the CLI's stored OAuth login
  and the hosted remote MCP endpoint.

### Changed

- Raise the minimum supported Node.js runtime to `>=20.0.0` (was `>=18.0.0`) so
  Node's default Happy Eyeballs / `autoSelectFamily` concurrent IPv4 fallback is
  a guaranteed contract. On a broken-IPv6 network (a global AAAA advertised with
  no working route) an older runtime without that default would wedge every
  connect on the unreachable address; requiring Node 20+ makes the fast IPv4
  fallback part of the supported-runtime contract.

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
