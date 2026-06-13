import { World, IWorldOptions, setWorldConstructor } from '@cucumber/cucumber';
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { IEmployeeData, generateEmployeeData } from './data';

let browser: Browser;

export class PSWorld extends World {
  private _page?: Page;
  private _context?: BrowserContext;
  baseUrl: string;
  employeeData: IEmployeeData;

  constructor(options: IWorldOptions) {
    super(options);
    this.baseUrl = (options.parameters as any).baseUrl ?? process.env.AUT_BASE_URL ?? '';
    this.employeeData = generateEmployeeData();
  }

  async initPlaywright(): Promise<void> {
    const b = await getBrowser();
    this._context = await b.newContext({ baseURL: this.baseUrl });
    this._page = await this._context.newPage();
  }
  async closeContext(): Promise<void> {
    if (this._context) {
      await this._context.close();
      this._context = undefined;
      this._page = undefined;
    }
  }

  get page(): Page {
    if (!this._page) throw new Error('Playwright page is not initialized. Call initPlaywright() in Before hook.');
    return this._page;
  }

  get context(): BrowserContext {
    if (!this._context) throw new Error('Playwright context is not initialized. Call initPlaywright() in Before hook.');
    return this._context;
  }
}

setWorldConstructor(PSWorld);

export async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) await browser.close();
}
