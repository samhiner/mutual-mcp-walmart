import { chromium, Browser, BrowserContext, Page } from "playwright";
import { loadCookies, saveCookies } from "./session.js";

// Stealth script to patch common bot-detection vectors
const STEALTH_INIT_SCRIPT = `
  // Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // Spoof plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ];
      arr.__proto__ = PluginArray.prototype;
      return arr;
    },
  });

  // Spoof languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // Patch permissions query
  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission, onchange: null })
      : origQuery(parameters);

  // Remove automation-related chrome properties
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
`;

let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;

export async function getBrowserContext(headless = true): Promise<BrowserContext> {
  if (contextInstance) return contextInstance;

  browserInstance = await chromium.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-infobars",
      "--window-size=1280,800",
    ],
  });

  /**
   * No fingerprint overrides.
   *
   * This used to claim a macOS Chrome 120 user agent, an America/Chicago
   * timezone and a Chicago geolocation — on whatever machine it happened to be
   * running. patchright's whole purpose is to look like a real browser, and
   * pinning those hands the site a browser that says it is a Mac in Illinois
   * while its TLS handshake, fonts, screen and clock all say otherwise. An
   * inconsistent fingerprint is a stronger signal than no override at all, and
   * this ran straight into a press-and-hold bot check.
   *
   * The viewport is kept because it is about what renders, not about identity.
   */
  contextInstance = await browserInstance.newContext({
    viewport: { width: 1280, height: 800 },
  });

  // Restore saved cookies
  const cookies = loadCookies();
  if (cookies && cookies.length > 0) {
    await contextInstance.addCookies(cookies as Parameters<BrowserContext["addCookies"]>[0]);
  }

  return contextInstance;
}

export async function getPage(): Promise<Page> {
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  await page.addInitScript(STEALTH_INIT_SCRIPT);
  return page;
}

export async function saveSessionCookies(): Promise<void> {
  if (!contextInstance) return;
  const cookies = await contextInstance.cookies();
  saveCookies(cookies);
}

export async function closeBrowser(): Promise<void> {
  if (contextInstance) {
    await saveSessionCookies();
    await contextInstance.close();
    contextInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  headless = true
): Promise<T> {
  const ctx = await getBrowserContext(headless);
  const page = await ctx.newPage();
  await page.addInitScript(STEALTH_INIT_SCRIPT);
  try {
    const result = await fn(page);
    await saveSessionCookies();
    return result;
  } finally {
    await page.close();
  }
}

export async function navigateToWalmart(page: Page, path = "/"): Promise<void> {
  const url = `https://www.walmart.com${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
}
