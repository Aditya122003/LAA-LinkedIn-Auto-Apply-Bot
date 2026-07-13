/**
 * debug_selectors.js — Opens one LinkedIn jobs search page and dumps:
 *   1. Screenshot of the page
 *   2. All class names in the DOM containing "job"
 *   3. The outerHTML of the first 2 potential job cards
 *
 * Usage: node src/debug_selectors.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_PATH = path.resolve(__dirname, '../session/storageState.json');

async function debug() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: null,
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  const url =
    'https://www.linkedin.com/jobs/search/?keywords=Node.js+Developer&location=India&f_AL=true';

  console.log('\n🔍 Navigating to:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log('⏳ Waiting 6s for page to fully render...');
  await page.waitForTimeout(6000);

  // Scroll to trigger lazy-load
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(3000);

  // Take screenshot
  const screenshotPath = path.resolve(__dirname, '../debug_screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);

  // Dump all classes containing "job" and check key selectors
  const domReport = await page.evaluate(() => {
    const report = {};

    // 1. Check all our candidate selectors
    const candidates = [
      'li[data-occludable-job-id]',
      'li[data-job-id]',
      '.job-card-container',
      '.jobs-search__results-list > li',
      '.scaffold-layout__list-item',
      '.job-card-list',
      '[class*="job-card"]',
      '[data-job-id]',
      '[data-occludable-job-id]',
      '.artdeco-list__item',
      'ul.jobs-search__results-list',
      '.jobs-search-results-list',
      '.jobs-search-results__list',
      'div[data-job-id]',
      'a[href*="/jobs/view/"]',
    ];

    report.selectorCounts = {};
    for (const sel of candidates) {
      try {
        report.selectorCounts[sel] = document.querySelectorAll(sel).length;
      } catch (e) {
        report.selectorCounts[sel] = `ERROR: ${e.message}`;
      }
    }

    // 2. All unique class names containing "job" (to find actual selectors)
    const allClasses = new Set();
    document.querySelectorAll('[class]').forEach((el) => {
      el.classList.forEach((cls) => {
        if (cls.toLowerCase().includes('job')) allClasses.add(cls);
      });
    });
    report.jobClassNames = [...allClasses].sort();

    // 3. All data-attributes on <li> elements
    const liAttrs = new Set();
    document.querySelectorAll('li').forEach((li) => {
      [...li.attributes].forEach((attr) => {
        if (attr.name.startsWith('data-')) liAttrs.add(attr.name);
      });
    });
    report.liDataAttributes = [...liAttrs].sort();

    // 4. First job link found (a href containing /jobs/view/)
    const firstJobLink = document.querySelector('a[href*="/jobs/view/"]');
    report.firstJobLink = firstJobLink
      ? {
          href: firstJobLink.getAttribute('href'),
          text: firstJobLink.textContent?.trim().slice(0, 100),
          parentHTML: firstJobLink.parentElement?.outerHTML?.slice(0, 500),
        }
      : null;

    // 5. Page title to confirm it's the right page
    report.pageTitle = document.title;
    report.bodyPreview = document.body.innerText.slice(0, 300);

    return report;
  });

  console.log('\n=== DOM REPORT ===\n');
  console.log('Page title:', domReport.pageTitle);
  console.log('\n--- Selector counts ---');
  for (const [sel, count] of Object.entries(domReport.selectorCounts)) {
    if (count > 0) console.log(`  ✅ ${sel}: ${count}`);
    else console.log(`  ❌ ${sel}: ${count}`);
  }
  console.log('\n--- Class names containing "job" ---');
  console.log(domReport.jobClassNames.join('\n'));
  console.log('\n--- Data attributes on <li> elements ---');
  console.log(domReport.liDataAttributes.join('\n'));
  console.log('\n--- First job link found ---');
  console.log(JSON.stringify(domReport.firstJobLink, null, 2));
  console.log('\n--- Body text preview ---');
  console.log(domReport.bodyPreview);

  // Save full report to file
  const reportPath = path.resolve(__dirname, '../debug_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(domReport, null, 2));
  console.log(`\n💾 Full report saved to: ${reportPath}`);

  await browser.close();
}

debug().catch((err) => {
  console.error('Debug failed:', err.message);
  process.exit(1);
});
