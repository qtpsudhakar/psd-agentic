# Cucumber + Playwright Scaffold

Quick scaffold for running Cucumber (`@cucumber/cucumber`) with Playwright and TypeScript.

Install and run:

```bash
npm install
npx playwright install
npm run test:cucumber
```

Notes:
- `package.json` uses wildcard versions (`*`) so `npm install` will fetch latest compatible releases.
- Steps follow a Page-Step-Definition (PSD) style under `steps/pages` and Playwright objects are provided via the `CustomWorld` in `support/world.ts`.
