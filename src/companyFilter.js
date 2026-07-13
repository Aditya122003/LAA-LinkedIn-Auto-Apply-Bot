/**
 * companyFilter.js — Fetch LinkedIn company follower counts with 7-day cache.
 *
 * Visits each company's LinkedIn page and extracts follower count.
 * Parses "15,234 followers" and "45K followers" formats.
 * Caches results in config/company_cache.json keyed by company name.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CACHE_FILE = path.resolve(__dirname, '../config/company_cache.json');
const CACHE_TTL_DAYS = 7;
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Load cache from disk */
function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Save cache to disk */
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * Parse follower count strings into plain numbers.
 * Handles: "15,234 followers", "45K followers", "1.2M followers"
 * @param {string} text
 * @returns {number|null}
 */
function parseFollowers(text) {
  if (!text) return null;

  const clean = text.toLowerCase().replace(/,/g, '').trim();

  // Match patterns like "45k", "1.2m", or plain numbers followed by "followers"
  const match = clean.match(/([\d.]+)\s*([km]?)\s*followers/);
  if (!match) return null;

  let value = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === 'k') value *= 1_000;
  else if (suffix === 'm') value *= 1_000_000;

  return Math.round(value);
}

/**
 * Fetch follower count for a company, using cache when available.
 * @param {import('playwright').Page} page - Playwright page (already authenticated)
 * @param {string} companyName
 * @param {string} companyPageUrl - LinkedIn company page URL
 * @returns {Promise<number|null>}
 */
async function getFollowerCount(page, companyName, companyPageUrl) {
  const cache = loadCache();
  const now = Date.now();

  // Check cache validity
  const cached = cache[companyName];
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    logger.info(`[Cache HIT] ${companyName} → ${cached.followers} followers`);
    return cached.followers;
  }

  // Navigate to company page
  logger.info(`[Followers] Fetching: ${companyName} — ${companyPageUrl}`);
  try {
    await page.goto(companyPageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // Try multiple selectors where LinkedIn shows follower counts
    let followers = null;

    const selectors = [
      // Company about section follower count
      'div[data-test-id="about-us__followers"] span',
      // Header follower count
      '.org-top-card-summary-info-list__info-item',
      // Generic text containing "followers"
      'span:has-text("followers")',
      'p:has-text("followers")',
    ];

    for (const selector of selectors) {
      try {
        const elements = await page.locator(selector).all();
        for (const el of elements) {
          const text = await el.textContent();
          const parsed = parseFollowers(text || '');
          if (parsed !== null) {
            followers = parsed;
            break;
          }
        }
        if (followers !== null) break;
      } catch {
        // Selector not found, try next
      }
    }

    // Fallback: scan all visible text for "X followers" pattern
    if (followers === null) {
      const pageText = await page.evaluate(() => document.body.innerText);
      const match = pageText.match(/([\d,]+\.?\d*\s*[KkMm]?)\s+followers/i);
      if (match) {
        followers = parseFollowers(match[0]);
      }
    }

    if (followers !== null) {
      // Update cache
      cache[companyName] = { followers, timestamp: now, url: companyPageUrl };
      saveCache(cache);
      logger.info(`[Followers] ${companyName} → ${followers.toLocaleString()} followers`);
    } else {
      logger.warn(`[Followers] Could not parse follower count for ${companyName}`);
      // Cache a null result briefly to avoid repeated failures
      cache[companyName] = { followers: null, timestamp: now, url: companyPageUrl };
      saveCache(cache);
    }

    return followers;
  } catch (err) {
    logger.error(`[Followers] Failed to fetch for ${companyName}: ${err.message}`);
    return null;
  }
}

/**
 * Filter jobs by minimum follower count.
 * Returns only jobs whose company has followers >= min_company_followers.
 * Modifies jobs in-place by adding .followers property.
 *
 * @param {import('playwright').Page} page
 * @param {Object[]} jobs
 * @param {number} minFollowers
 * @returns {Promise<Object[]>}
 */
async function filterByFollowers(page, jobs, minFollowers) {
  const qualifying = [];

  // Deduplicate companies to avoid redundant lookups
  const companyMap = new Map();
  for (const job of jobs) {
    if (!companyMap.has(job.company)) {
      companyMap.set(job.company, job.companyPageUrl);
    }
  }

  // Fetch follower counts for each unique company
  const followerCounts = new Map();
  for (const [company, pageUrl] of companyMap.entries()) {
    if (pageUrl) {
      const count = await getFollowerCount(page, company, pageUrl);
      followerCounts.set(company, count);
      // Polite delay between company page visits
      await page.waitForTimeout(1000 + Math.random() * 1500);
    } else {
      followerCounts.set(company, null);
    }
  }

  // Filter jobs
  for (const job of jobs) {
    const followers = followerCounts.get(job.company);
    job.followers = followers;

    if (followers === null) {
      logger.warn(`[Filter] Skipping ${job.company} — follower count unavailable`);
      continue;
    }

    if (followers >= minFollowers) {
      qualifying.push(job);
    } else {
      logger.warn(
        `[Filter] Skipping ${job.company} — ${followers.toLocaleString()} followers < ${minFollowers.toLocaleString()} required`
      );
    }
  }

  logger.info(`[Filter] ${qualifying.length}/${jobs.length} jobs passed follower filter`);
  return qualifying;
}

module.exports = { filterByFollowers, parseFollowers, getFollowerCount };
