# PSD Framework — Cucumber + Playwright + AI Agents

An AI-native test automation framework using **Page Step Definitions (PSD)** — write Gherkin, agents generate and heal the TypeScript.

## Quick Start

```bash
npm install
npx playwright install
npm test
```

## Documentation

| Guide | Description |
|---|---|
| [Architecture](./docs/ARCHITECTURE.md) | Framework design, components, and data flow |
| [Writing Tests](./docs/WRITING-TESTS.md) | How to create feature files and trigger test generation |
| [Healing Failures](./docs/HEALING-FAILURES.md) | How to diagnose and fix broken step definitions |
| [GitHub Agentic Workflows](./docs/AGENTIC-WORKFLOWS.md) | How automated workflows generate and maintain tests |

## Core Concept

> Write Gherkin → agent generates steps → tests run. No manual page classes. No maintenance layers.

Steps follow a Page-Step-Definition (PSD) pattern under `steps/pages/`. Playwright objects are provided via `PSWorld` in `support/world.ts`. AI agents (VS Code `@Test Definition Generator`, `@Test Healer`) and GitHub Agentic Workflows handle all TypeScript generation and healing automatically.
