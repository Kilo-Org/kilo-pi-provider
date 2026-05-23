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

## License and attribution

This repository is a Kilo-maintained derivative of [mrexodia/kilo-pi-provider](https://github.com/mrexodia/kilo-pi-provider). The original source and Kilo modifications are distributed under the [Boost Software License 1.0](./LICENSE).
