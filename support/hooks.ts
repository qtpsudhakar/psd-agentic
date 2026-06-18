import { Before, After, AfterAll, AfterStep, setDefaultTimeout } from '@cucumber/cucumber';
import { PSWorld, closeBrowser } from './world';
import { expect } from '@playwright/test';

setDefaultTimeout(120_000);

Before(async function (this: PSWorld) {
  await this.initPlaywright();
  expect.configure({ timeout: 10000 });
});

// ── Level 1 self-healing: capture diagnostics on step failure ─────────────────
// Screenshots and DOM snapshots are attached to the Allure report so the
// heal-steps agentic workflow has full context about what the page looked like
// when the locator failed — without needing to re-run to reproduce.
AfterStep(async function (this: PSWorld, { result }) {
  if (result?.status !== 'FAILED') return;
  try {
    // 1. Screenshot — visual proof of page state at failure
    const screenshot = await this.page.screenshot({ fullPage: true });
    this.attach(screenshot, 'image/png');

    // 2. Page URL — tells the healing agent exactly where to navigate
    this.attach(`Failure URL: ${this.page.url()}`, 'text/plain');

    // 3. ARIA snapshot — the ground truth for locator regeneration
    const ariaSnapshot = await this.page.evaluate(() => {
      const walk = (el: Element, depth = 0): string => {
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 60) || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const testId = el.getAttribute('data-testid') || '';
        const attrs = [
          role,
          name ? `"${name}"` : '',
          placeholder ? `placeholder="${placeholder}"` : '',
          testId ? `data-testid="${testId}"` : '',
        ].filter(Boolean).join(' ');
        const indent = '  '.repeat(depth);
        let out = `${indent}- ${attrs}\n`;
        for (const child of Array.from(el.children)) {
          out += walk(child, depth + 1);
        }
        return out;
      };
      return walk(document.body);
    });
    this.attach(`DOM Snapshot at failure:\n\n${ariaSnapshot}`, 'text/plain');

    // 4. Interactive elements — the same data the generator uses to build locators
    const interactiveElements = await this.page.evaluate(() => {
      const sel = [
        'button', 'a[href]', 'input', 'select', 'textarea',
        '[role=button]', '[role=link]', '[role=tab]', '[role=checkbox]',
        '[role=combobox]', '[role=textbox]', '[role=menuitem]',
      ].join(', ');
      return Array.from(document.querySelectorAll(sel)).map(el => ({
        tag:         el.tagName.toLowerCase(),
        text:        el.textContent?.trim().slice(0, 80) || null,
        placeholder: el.getAttribute('placeholder') || null,
        testId:      el.getAttribute('data-testid') || null,
        name:        el.getAttribute('name') || null,
        ariaLabel:   el.getAttribute('aria-label') || null,
        role:        el.getAttribute('role') || null,
        visible:     (el as HTMLElement).offsetParent !== null,
      }));
    });
    this.attach(
      `Interactive elements at failure:\n${JSON.stringify(interactiveElements, null, 2)}`,
      'text/plain',
    );
  } catch {
    // Page may already be closed or navigated away — diagnostics are best-effort
  }
});

After(async function (this: PSWorld) {
  await this.closeContext();
});

AfterAll(async function () {
  await closeBrowser();
});
