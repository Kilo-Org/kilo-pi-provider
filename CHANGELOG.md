# Changelog

All notable changes are documented here.

Release versions use calendar versioning: `YYYY.MM.PATCH`. `PATCH` starts at `0` each month and increments for each release in that month.

## [Unreleased]

## [2026.08.2] - 2026-08-30

### Breaking Changes

- Rename Pi-extension environment variables to the `KILO_PI_` namespace ([#26](https://github.com/Kilo-Org/kilo-pi-provider/pull/26)):
  - `KILO_CUSTOM_FOOTER` → `KILO_PI_CUSTOM_FOOTER`
  - `KILO_SHOW_CREDITS` → `KILO_PI_SHOW_CREDITS`
  - `KILO_USAGE` → `KILO_PI_USAGE`

### Fixed

- Derive each selected usage period from the shared widest-range API response ([#25](https://github.com/Kilo-Org/kilo-pi-provider/pull/25)).

## [2026.08.1] - 2026-08-29

### Added

- Add global and trusted-project preference files for footer, credits, and usage reporting ([#21](https://github.com/Kilo-Org/kilo-pi-provider/pull/21)).
- Support daily, weekly, monthly, and yearly usage statuses ([#21](https://github.com/Kilo-Org/kilo-pi-provider/pull/21)).

### Changed

- Support comma-separated usage periods in configuration and `KILO_PI_USAGE`, for example `day,week` ([#21](https://github.com/Kilo-Org/kilo-pi-provider/pull/21)).

## [2026.08.0] - 2026-08-29

### Added

- Introduce calendar versioning and tagged release tracking.
- Add opt-in Kilo daily usage reporting ([#18](https://github.com/Kilo-Org/kilo-pi-provider/pull/18)) and configurable footer credits ([#19](https://github.com/Kilo-Org/kilo-pi-provider/pull/19)).
- Support API-key authentication in runtime catalog refreshes, credit refreshes, and terms-notice handling ([#13](https://github.com/Kilo-Org/kilo-pi-provider/pull/13)).
- Add Vitest source-coverage reporting ([#15](https://github.com/Kilo-Org/kilo-pi-provider/pull/15)).

### Changed

- Allow the custom Kilo footer and credit display to be configured independently ([#19](https://github.com/Kilo-Org/kilo-pi-provider/pull/19)).
- Extract API, authentication, model-catalog, and footer concerns into focused modules ([#9](https://github.com/Kilo-Org/kilo-pi-provider/pull/9), [#12](https://github.com/Kilo-Org/kilo-pi-provider/pull/12), [#20](https://github.com/Kilo-Org/kilo-pi-provider/pull/20)).
- Move extension source files under `src/` ([#14](https://github.com/Kilo-Org/kilo-pi-provider/pull/14)).
- Add Biome checks, pre-commit support, and Vitest source-coverage reporting ([#10](https://github.com/Kilo-Org/kilo-pi-provider/pull/10), [#11](https://github.com/Kilo-Org/kilo-pi-provider/pull/11), [#15](https://github.com/Kilo-Org/kilo-pi-provider/pull/15)).

### Fixed

- Avoid installing the development-only Prek hook during Pi package installation ([#17](https://github.com/Kilo-Org/kilo-pi-provider/pull/17)).
- Expose DeepSeek V4 Flash and Pro `max` thinking for Kilo catalog models ([#3](https://github.com/Kilo-Org/kilo-pi-provider/issues/3), [#12](https://github.com/Kilo-Org/kilo-pi-provider/pull/12)).
- Restore compatibility with current Pi authentication storage and provider-registration APIs.

## Historical package versions

The releases below predate changelog and tag tracking. Their dates are the commits that changed `package.json` to the recorded version.

## [1.2.0] - 2026-03-08

### Added

- Add Kilo credit balance to the Pi footer ([commit](https://github.com/Kilo-Org/kilo-pi-provider/commit/c3fc536)).

### Changed

- Update package metadata for Kilo-maintained distribution.

## [1.1.0] - 2026-02-27

### Fixed

- Refresh authentication and the model list after Kilo login ([commit](https://github.com/Kilo-Org/kilo-pi-provider/commit/9711fb0)).

## [1.0.0] - 2026-02-27

### Added

- Add the initial Kilo provider extension for Pi ([commit](https://github.com/Kilo-Org/kilo-pi-provider/commit/2e8458a)).

## Historical unversioned changes

### 2026-05-14

- Add organization selection and organization-scoped Kilo model catalogs ([commit](https://github.com/Kilo-Org/kilo-pi-provider/commit/d2c3d4b)).
- Expose Kilo reasoning variants through Pi thinking levels ([commit](https://github.com/Kilo-Org/kilo-pi-provider/commit/d2c3d4b)).
- Route OpenAI reasoning models through Kilo's Responses-compatible endpoint ([commit](https://github.com/Kilo-Org/kilo-pi-provider/commit/fda43f5)).

### 2026-04-04

- Include `kilo-auto/free` in the anonymous free-model catalog ([commit](https://github.com/Kilo-Org/kilo-pi-provider/commit/3e0ffb2)).
