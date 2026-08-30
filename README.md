# Kilo Provider for Pi

Official Kilo-maintained provider extension for [Pi](https://pi.dev). Access Kilo Gateway models with free-model support, browser authentication, and organization accounts.

## Features

- Use free Kilo Gateway models without signing in
- Sign in to access the full model catalog and select a personal or organization account
- Expose Kilo reasoning variants through Pi thinking levels
- Route responses-only OpenAI models through the compatible Kilo endpoint

## Prerequisites

Install [Pi](https://pi.dev), the coding agent CLI:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

## Installation

Install the latest version:

```bash
pi install git:github.com/Kilo-Org/kilo-pi-provider
```

For a reproducible installation, pin a [release tag](./CHANGELOG.md):

```bash
pi install git:github.com/Kilo-Org/kilo-pi-provider@v2026.08.0
```

## Usage

Start Pi as usual:

```bash
pi
```

Free models are available immediately. To access all models, sign in with your [Kilo](https://kilo.ai) account:

```text
/login kilo
```

This opens your browser for device authorization. When your account belongs to organizations, Pi lets you choose which Kilo account to use.

You can also set `KILO_API_KEY` directly instead of using the login flow. Set `KILO_ORG_ID` or `KILOCODE_ORGANIZATION_ID` to bill and filter models for an organization account.

### Footer

Kilo replaces Pi's footer by default to show usage and credits. To keep another extension's custom footer, disable Kilo's footer:

```bash
KILO_PI_CUSTOM_FOOTER=0 pi
```

Kilo credits are shown by default and remain available as the `kilo-credits` footer status. To hide them and avoid balance requests, set `KILO_PI_SHOW_CREDITS=0`:

```bash
KILO_PI_SHOW_CREDITS=0 pi
```

### Preferences

Set non-secret preferences globally in `~/.pi/agent/extensions/kilo-pi-provider/config.json`, or per trusted project in `.pi/extensions/kilo-pi-provider/config.json`:

```json
{
  "footer": { "custom": false },
  "credits": { "enabled": true },
  "usage": { "periods": ["day", "week"] }
}
```

A trusted project file overrides the global file, and environment variables override both. Project preferences are ignored until Pi trusts the project. Keep API keys and OAuth credentials out of these files.

Environment overrides are useful for one-off sessions:

```bash
KILO_PI_USAGE=day,week pi
```

`KILO_PI_USAGE` accepts comma-separated periods; `1`, `true`, and `yes` remain shorthand for `day`. Usage refreshes at session start and after completed turns.

## Development

Source modules are under `src/`; `src/index.ts` is the Pi extension entry point.

Install dependencies:

```bash
npm ci
```

Install [Prek](https://github.com/j178/prek)'s pre-commit hook locally:

```bash
npx prek install
```

Before each commit it runs Biome, which applies safe formatting and lint fixes. If it changes files, review and stage those changes before committing again. The hook is not installed automatically so Pi package installation, which omits development dependencies, succeeds.

Run the checks and tests directly with:

```bash
npm run check
npm run typecheck
npm test
npm run test:coverage
```

`typecheck` runs TypeScript in strict, no-emit mode against source, tests, and TypeScript configuration. It checks the extension against the pinned Pi API types and is intentionally not part of CI or the pre-commit hook.

When changing TypeScript, run `npm run typecheck` and resolve every type error in the files you touch. Fix the underlying types or implementation; do not silence errors with `any`, unsafe casts, `@ts-ignore`, or weaker compiler settings.

`test:coverage` reports V8 coverage for `src/` and writes HTML and LCOV reports to `coverage/`.

To run the pre-commit hook against every tracked file:

```bash
npx prek run --all-files
```

## License and attribution

This repository is a Kilo-maintained derivative of [mrexodia/kilo-pi-provider](https://github.com/mrexodia/kilo-pi-provider). The original source and Kilo modifications are distributed under the [Boost Software License 1.0](./LICENSE).
