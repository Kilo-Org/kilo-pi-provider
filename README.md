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

```bash
pi install git:github.com/Kilo-Org/kilo-pi-provider
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

Kilo credits remain available as the `kilo-credits` footer status.

## Development

Source modules are under `src/`; `src/index.ts` is the Pi extension entry point.

Install dependencies:

```bash
npm ci
```

This installs [Prek](https://github.com/j178/prek)'s pre-commit hook. Before each commit it runs Biome, which applies safe formatting and lint fixes. If it changes files, review and stage those changes before committing again.

Run the checks and tests directly with:

```bash
npm run check
npm test
```

To run the pre-commit hook against every tracked file:

```bash
npx prek run --all-files
```

## License and attribution

This repository is a Kilo-maintained derivative of [mrexodia/kilo-pi-provider](https://github.com/mrexodia/kilo-pi-provider). The original source and Kilo modifications are distributed under the [Boost Software License 1.0](./LICENSE).
