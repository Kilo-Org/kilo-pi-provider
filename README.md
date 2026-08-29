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
KILO_CUSTOM_FOOTER=0 pi
```

Kilo credits are shown by default and remain available as the `kilo-credits` footer status. To hide them and avoid balance requests, set `KILO_SHOW_CREDITS=0`:

```bash
KILO_SHOW_CREDITS=0 pi
```

To show today's Kilo spend, opt in to usage status reporting:

```bash
KILO_USAGE=1 pi
```

`KILO_USAGE` also accepts `true`, `yes`, or `day`. Daily usage refreshes at session start and after completed turns.

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
npm test
npm run test:coverage
```

`test:coverage` reports V8 coverage for `src/` and writes HTML and LCOV reports to `coverage/`.

To run the pre-commit hook against every tracked file:

```bash
npx prek run --all-files
```

## License and attribution

This repository is a Kilo-maintained derivative of [mrexodia/kilo-pi-provider](https://github.com/mrexodia/kilo-pi-provider). The original source and Kilo modifications are distributed under the [Boost Software License 1.0](./LICENSE).
