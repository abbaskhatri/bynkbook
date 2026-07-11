import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = "C:/Users/abbas/Bynkbook-app";
const require = createRequire(`${root}/bynkbook-web/package.json`);
const { chromium } = require("playwright");
const authOrigin = "https://app.bynkbook.com";
const base = process.env.AUDIT_BASE || authOrigin;
const sourceStorage = `${root}/bynkbook-web/auth/bynkbook-qa-auth.json`;
const outDir = `${root}/output/playwright/re-audit-2026-07-11`;
const businessId = "a05b0683-1216-4459-820a-6da84e57e929";
const accountId = "086435cc-290f-4c6d-a4b9-317590cf19d7";

fs.mkdirSync(outDir, { recursive: true });

async function refreshedStorageState() {
  const state = JSON.parse(fs.readFileSync(sourceStorage, "utf8"));
  const origin = state.origins.find((row) => row.origin === authOrigin);
  const items = origin?.localStorage ?? [];
  const refreshToken = items.find((row) => row.name.endsWith(".refreshToken"))?.value;
  if (!refreshToken) throw new Error("QA storage has no refresh token");

  const response = await fetch("https://cognito-idp.us-east-1.amazonaws.com/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: "38gus49pnfilbc4u2f7b68ist7",
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  });
  let body = await response.json().catch(() => null);
  if (!response.ok || !body?.AuthenticationResult?.AccessToken) {
    const password = fs.readFileSync(`${root}/.qa/qa-audit-password.txt`, "utf8").trim();
    const passwordResponse = await fetch("https://cognito-idp.us-east-1.amazonaws.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: "38gus49pnfilbc4u2f7b68ist7",
        AuthParameters: { USERNAME: "qa.audit@bynkbook.dev", PASSWORD: password },
      }),
    });
    body = await passwordResponse.json().catch(() => null);
    if (!passwordResponse.ok || !body?.AuthenticationResult?.AccessToken) {
      throw new Error(`QA authentication failed (${passwordResponse.status})`);
    }
  }

  for (const item of items) {
    if (item.name.endsWith(".accessToken")) item.value = body.AuthenticationResult.AccessToken;
    if (item.name.endsWith(".idToken")) item.value = body.AuthenticationResult.IdToken;
    if (item.name.endsWith(".clockDrift")) item.value = "0";
  }
  if (base !== authOrigin) {
    state.origins = [
      ...state.origins.filter((row) => row.origin !== base),
      { origin: base, localStorage: items.map((item) => ({ ...item })) },
    ];
  }
  return state;
}

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
];

const browser = await chromium.launch({ headless: true });
const storageState = await refreshedStorageState();
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({ storageState, viewport });
  const page = await context.newPage();
  const responses = [];
  const consoleErrors = [];
  const started = Date.now();

  page.on("response", (response) => {
    if (!response.url().includes("/v1/")) return;
    responses.push({
      status: response.status(),
      url: response.url().replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]"),
      elapsedMs: Date.now() - started,
    });
  });
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleErrors.push({ type: message.type(), text: message.text().slice(0, 500) });
    }
  });

  await page.goto(
    `${base}/reconcile?businessId=${businessId}&accountId=${accountId}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );

  const checkpoints = [];
  for (const delay of [2_000, 8_000, 20_000]) {
    await page.waitForTimeout(delay);
    checkpoints.push({
      elapsedMs: Date.now() - started,
      skeletons: await page.locator(".animate-pulse").count(),
      loadingText: await page.getByText(/Loading|loads when opened|preparing/i).count(),
    });
  }

  const layout = await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    };
    const controls = Array.from(document.querySelectorAll("button,input,[role='combobox']"))
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: String(element.textContent || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").trim().slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          clipped: element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2,
          outsideViewport: rect.left < -1 || rect.right > innerWidth + 1,
        };
      })
      .filter((row) => row.clipped || row.outsideViewport);
    const surface = document.querySelector(".bb-page-command-surface")?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      horizontalPageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      commandSurface: surface ? {
        left: Math.round(surface.left),
        right: Math.round(surface.right),
        width: Math.round(surface.width),
      } : null,
      flaggedControls: controls,
    };
  });

  const screenshot = path.join(outDir, `reconcile-${viewport.name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  results.push({
    viewport,
    finalUrl: page.url(),
    title: await page.locator("h1").first().textContent().catch(() => ""),
    checkpoints,
    layout,
    failedResponses: responses.filter((row) => row.status >= 400),
    responses,
    consoleErrors,
    screenshot,
  });
  await context.close();
}

await browser.close();
fs.writeFileSync(path.join(outDir, "reconcile-runtime-audit.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
