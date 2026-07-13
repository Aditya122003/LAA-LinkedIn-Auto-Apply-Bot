/**
 * search.js — Fast job card collector.
 *
 * Just reads li[data-occludable-job-id] cards from the page without clicking.
 * Titles come from the card HTML. No description fetching, no right-pane clicks.
 * This keeps the search page intact so pagination works correctly.
 */

const logger = require('./logger');
const BASE = 'https://www.linkedin.com';
const SEARCH_LOCATIONS = ['India', 'Remote'];

function buildSearchUrl(role, location) {
  const params = new URLSearchParams({
    keywords: role,
    location,
    f_AL: 'true',   // Easy Apply only
    sortBy: 'DD',   // Most recent
    f_E: '1,2,3',   // Entry Level, Associate, Internship (no Senior+)
  });
  return `${BASE}/jobs/search/?${params.toString()}`;
}

async function sleep(page, min, max) {
  await page.waitForTimeout(min + Math.random() * (max - min));
}

function isBrowserClosed(err) {
  const m = err?.message || '';
  return m.includes('closed') || m.includes('Target page') || m.includes('context');
}

function dedupeTitle(raw) {
  let t = (raw || '').trim();
  const half = Math.ceil(t.length / 2);
  if (half > 0 && t.slice(0, half).trim() === t.slice(half).trim()) t = t.slice(0, half).trim();
  return t.replace(/\s+/g, ' ');
}

/** Read all job cards from the current page — no clicking, no navigation */
async function scrapeCards(page) {
  try {
    await page.waitForSelector('li[data-occludable-job-id]', { timeout: 20_000 });
  } catch {
    logger.warn('[Search] No cards found within 20s');
    return [];
  }

  // Scroll to trigger lazy-load of all cards
  await page.evaluate(() => {
    const list = document.querySelector('.jobs-search-results-list') ||
                 document.querySelector('[class*="results-list"]');
    if (list) list.scrollTop = list.scrollHeight;
    else window.scrollTo(0, 800);
  });
  await sleep(page, 1200, 2000);

  const cards = await page.evaluate((base) => {
    const results = [];
    for (const card of document.querySelectorAll('li[data-occludable-job-id]')) {
      const jobId = card.dataset.occludableJobId;
      if (!jobId) continue;

      const titleEl = card.querySelector('.job-card-list__title--link') ||
                      card.querySelector('a[href*="/jobs/view/"]');
      let title = titleEl?.innerText?.trim() || titleEl?.textContent?.trim() || '';
      // Deduplicate LinkedIn's accessibility title doubling
      const half = Math.ceil(title.length / 2);
      if (half > 0 && title.slice(0, half).trim() === title.slice(half).trim())
        title = title.slice(0, half).trim();
      title = title.replace(/\s+/g, ' ');

      const companyEl = card.querySelector('.job-card-container__primary-description') ||
                        card.querySelector('.artdeco-entity-lockup__subtitle');
      const company = companyEl?.innerText?.trim() || 'Unknown';

      const locEl = card.querySelector('.job-card-container__metadata-item') ||
                    card.querySelector('[class*="metadata-item"]');
      const location = locEl?.innerText?.trim() || '';

      const companyLinkEl = card.querySelector('a[href*="/company/"]');
      const rawHref = companyLinkEl?.getAttribute('href') || '';
      const companyPageUrl = rawHref
        ? (rawHref.startsWith('http') ? rawHref.split('?')[0] : `${base}${rawHref.split('?')[0]}`)
        : null;

      const jobUrl = `${base}/jobs/view/${jobId}/`;
      results.push({ title, company, companyPageUrl, location, jobUrl, url: jobUrl, description: title });
    }
    return results;
  }, BASE);

  logger.info(`[Search] ${cards.length} cards on page`);
  return cards;
}

/**
 * Search all role × location combos. Returns deduplicated job list.
 */
async function searchJobs(page, profile) {
  const seenIds = new Set();
  const allJobs = [];
  const total = profile.role_titles.length * SEARCH_LOCATIONS.length;
  let combo = 0;

  outer:
  for (const role of profile.role_titles) {
    for (const location of SEARCH_LOCATIONS) {
      combo++;
      logger.info(`[Search] Combo ${combo}/${total}: "${role}" in "${location}"`);

      try {
        await page.goto(buildSearchUrl(role, location), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(page, 2500, 4000);

        const cards = await scrapeCards(page);
        let newCount = 0;
        for (const job of cards) {
          const id = job.jobUrl.match(/\/jobs\/view\/(\d+)/)?.[1] ?? job.jobUrl;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allJobs.push(job);
            newCount++;
          }
        }
        logger.info(`[Search] ${cards.length} found, ${newCount} new (total: ${allJobs.length})`);
        await sleep(page, 1000, 2000);

      } catch (err) {
        if (isBrowserClosed(err)) {
          logger.warn(`[Search] Browser closed — collected ${allJobs.length} jobs so far.`);
          break outer;
        }
        logger.error(`[Search] Failed "${role}"/"${location}": ${err.message}`);
      }
    }
  }

  logger.info(`[Search] Done — ${allJobs.length} unique jobs collected.`);
  return allJobs;
}

module.exports = { searchJobs };
