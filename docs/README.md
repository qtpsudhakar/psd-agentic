# PSD Framework — Documentation Hub

**Page Step Definitions (PSD)** is an AI-native test automation framework built on Cucumber + Playwright + TypeScript. It eliminates the traditional Page Object Model (POM) in favor of a simpler, more maintainable pattern where step definitions directly implement browser interactions — and AI agents generate and heal those steps automatically.

---

## Documentation Index

| Document | Description |
|---|---|
| [Architecture](./ARCHITECTURE.md) | Framework design, components, and data flow |
| [Writing Tests](./WRITING-TESTS.md) | How to create feature files and trigger test generation |
| [Healing Failures](./HEALING-FAILURES.md) | How to diagnose and fix broken step definitions |
| [GitHub Agentic Workflows](./AGENTIC-WORKFLOWS.md) | How automated workflows generate and maintain tests |

---

## Quick Start

```bash
npm install
npx playwright install
npm test
```

## Core Principle

> Write Gherkin → agent generates steps → tests run. No manual page classes. No maintenance layers.

The feature file is your complete test design. Everything else is automated.
