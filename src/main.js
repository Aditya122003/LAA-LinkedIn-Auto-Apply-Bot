/**
 * main.js — Stay on search page, click each card, apply from right pane.
 *
 * This is the only approach that reliably shows the Easy Apply button.
 * Navigating directly to job URLs does NOT show Easy Apply for many jobs.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const dns = require('dns').promises;

const profile    = require('../config/profile.json');
const { countAppliedToday, isAlreadyApplied, recordApplication } = require('./tracker');
const logger     = require('./logger');

const SESSION_PATH = path.resolve(__dirname, '../session/storageState.json');
const RESUME_PATH  = path.resolve(__dirname, '..', profile.resume_file_path);
const ANSWERS_FILE = path.resolve(__dirname, '../config/answers.json');

const BASE = 'https://www.linkedin.com';
const SEARCH_LOCATIONS = ['India', 'Remote'];

// Easy Apply button in the RIGHT PANE of search results (confirmed selectors)
const EASY_APPLY_BTN = [
  'button.jobs-apply-button--top-card',
  'button.jobs-apply-button',
  '.jobs-s-apply button',
].join(', ');

function buildSearchUrl(role, location) {
  const params = new URLSearchParams({
    keywords: role, location,
    f_AL: 'true', sortBy: 'DD', f_E: '2,3',
  });
  return `${BASE}/jobs/search/?${params.toString()}`;
}

function loadAnswers() {
  try { return JSON.parse(fs.readFileSync(ANSWERS_FILE, 'utf8')); } catch { return {}; }
}
function saveAnswers(a) { fs.writeFileSync(ANSWERS_FILE, JSON.stringify(a, null, 2), 'utf8'); }

async function waitForInternet(maxRetries = 24, delayMs = 5000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await dns.lookup('linkedin.com');
      return true;
    } catch (err) {
      logger.info(`[Main] Waiting for internet connection... (Attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

function findAnswer(question, answers) {
  const q = question.toLowerCase().trim();
  for (const [k, v] of Object.entries(answers)) if (k.toLowerCase().trim() === q) return v;
  for (const [k, v] of Object.entries(answers)) {
    const kl = k.toLowerCase().trim();
    if (q.includes(kl) || kl.includes(q)) return v;
  }
  return null; // caller must handle null = skip
}

function guessAnswer(question) {
  const q = question.toLowerCase().trim();

  // 1. Notice period / Immediate joining / availability
  if (q.includes('immediate') || q.includes('immediately')) {
    if (q.includes('join') || q.includes('start') || q.includes('available') || q.includes('can you')) {
      return 'No'; // Notice period is 30 days
    }
  }
  if (q.includes('notice period') || q.includes('notice')) {
    if (q.includes('in days') || q.includes('number of days') || q.includes('(in days)')) {
      return '30';
    }
    return '30 days';
  }
  if (q.includes('how soon') || q.includes('how many days') || q.includes('earliest start date')) {
    if (q.includes('days')) return '30';
    return '30 days';
  }

  // 2. Location (Current Location is Delhi)
  if (q.includes('live in') || q.includes('located in') || q.includes('reside in') || q.includes('based in') || q.includes('work in')) {
    if (q.includes('delhi') || q.includes('noida') || q.includes('gurgaon') || q.includes('ncr')) {
      return 'Yes';
    }
    // Any other location: Jodhpur, Bangalore, Mumbai, Pune, Chennai, Jodhpur, etc.
    const otherCities = ['jodhpur', 'mumbai', 'pune', 'bangalore', 'bengaluru', 'chennai', 'hyderabad', 'kolkata', 'jaipur', 'gurugram'];
    if (otherCities.some(city => q.includes(city))) {
      return 'No';
    }
  }
  if (q.includes('current city') || q.includes('current location') || q.includes('where do you live') || q.includes('where are you located')) {
    return 'Delhi';
  }

  // 3. Years of experience (1 year of experience)
  if (q.includes('years of experience') || q.includes('how many years') || q.includes('experience do you have') || q.includes('experience in') || q.includes('work experience')) {
    return '1';
  }

  // 4. Salary / CTC (current 3 LPA, expected 5 LPA)
  if (q.includes('current ctc') || q.includes('current fixed salary') || q.includes('current salary') || q.includes('fixed salary') || q.includes('current compensation') || q.includes('current fixed pay')) {
    if (q.includes('lakhs') || q.includes('lpa') || q.includes('in lakhs') || q.includes('per annum')) {
      return '3';
    }
    return '300000';
  }
  if (q.includes('expected ctc') || q.includes('expected fixed salary') || q.includes('expected salary') || q.includes('expected compensation') || q.includes('expected fixed pay') || q.includes('minimum salary')) {
    if (q.includes('lakhs') || q.includes('lpa') || q.includes('in lakhs') || q.includes('per annum')) {
      return '5';
    }
    return '500000';
  }

  // 5. General authorizations / comfort / background check
  if (q.includes('authorized to work') || q.includes('legal authority') || q.includes('eligible to work')) return 'Yes';
  if (q.includes('sponsorship') || q.includes('sponsor')) return 'No';
  if (q.includes('willing to relocate') || q.includes('relocation')) return 'Yes';
  if (q.includes('hybrid') || q.includes('office') || q.includes('remote') || q.includes('onsite')) return 'Yes';
  if (q.includes('background check') || q.includes('drug screen')) return 'Yes';
  if (q.includes('degree') || q.includes('graduate') || q.includes('graduation') || q.includes('bachelor') || q.includes('education')) return 'Yes';

  // 6. Experience / Familiarity with skills (common sense answer is Yes)
  if (q.includes('have you worked') || q.includes('do you have experience') || q.includes('have you supported') || q.includes('are you familiar') || q.includes('do you know') || q.includes('knowledge of')) {
    return 'Yes';
  }

  return null; // Could not guess
}

async function fallbackTextGuess(label, input) {
  const q = label.toLowerCase().trim();
  const isNumberType = (await input.getAttribute('type').catch(() => '')) === 'number';

  // If it's number type or looks like a numeric question, guess "1"
  if (isNumberType || q.includes('years') || q.includes('how many') || q.includes('count') || q.includes('gpa') || q.includes('experience') || q.includes('number of') || q.includes('rate your')) {
    if (q.includes('notice') || q.includes('days')) return '30';
    return '1';
  }

  // Location / city
  if (q.includes('city') || q.includes('location') || q.includes('address') || q.includes('where') || q.includes('residence') || q.includes('live')) {
    return 'Delhi';
  }

  // Yes / No text questions
  if (q.includes('do you') || q.includes('are you') || q.includes('will you') || q.includes('can you') || q.includes('should you') || q.includes('would you')) {
    if (q.includes('immediately')) return 'No';
    return 'Yes';
  }

  // General text fallback (skills/languages/tools or other text)
  if (q.includes('skill') || q.includes('tool') || q.includes('language') || q.includes('framework') || q.includes('technology') || q.includes('software')) {
    return 'Node.js, SQL, Python';
  }

  return '1'; // safe general numeric/text fallback
}

async function fallbackTextareaGuess(label) {
  const q = label.toLowerCase().trim();
  if (q.includes('why') || q.includes('describe') || q.includes('about') || q.includes('reason') || q.includes('interest') || q.includes('summary')) {
    return 'I have strong experience in full-stack development using Node.js, SQL, and Python, and I am excited to apply my skills to solve problems in this role.';
  }
  return 'Node.js, SQL, Python';
}

async function getLabelText(page, id) {
  if (!id) return '';
  return page.evaluate(id => {
    const lbl = document.querySelector(`label[for="${id}"]`);
    if (lbl) return lbl.textContent?.trim() || '';
    const el = document.getElementById(id);
    return el?.getAttribute('aria-label') || el?.getAttribute('placeholder') || '';
  }, id);
}

async function fillFormStep(page, answers) {
  await page.waitForTimeout(1000);

  // Resume upload
  for (const fi of await page.locator('input[type="file"]').all()) {
    try {
      if (await fi.isVisible({ timeout: 500 }) && fs.existsSync(RESUME_PATH)) {
        logger.info('[Apply] Uploading resume...');
        await fi.setInputFiles(RESUME_PATH);
        await page.waitForTimeout(1500);
      }
    } catch {}
  }

  // Text / number inputs
  for (const input of await page.locator('input[type="text"],input[type="number"],input[type="tel"],input[type="email"]').all()) {
    try {
      if (!await input.isVisible({ timeout: 300 })) continue;
      if ((await input.inputValue().catch(() => '')).trim()) continue;
      const id = await input.getAttribute('id').catch(() => '');
      const label = await getLabelText(page, id);
      if (!label) continue;
      let ans = findAnswer(label, answers);
      if (ans === null) {
        ans = guessAnswer(label);
        if (ans === null) {
          ans = await fallbackTextGuess(label, input);
          logger.info(`[Guesser] Fallback text guessed: "${label}" -> "${ans}"`);
        }
        if (ans !== null) {
          answers[label] = ans;
          saveAnswers(answers);
        }
      }
      if (ans !== null) {
        await input.fill(String(ans));
      } else {
        throw new Error('UNKNOWN_QUESTION: ' + label);
      }
    } catch (err) {
      if (err.message.includes('UNKNOWN_QUESTION')) throw err;
    }
  }

  // Textareas
  for (const ta of await page.locator('textarea').all()) {
    try {
      if (!await ta.isVisible({ timeout: 300 })) continue;
      if ((await ta.inputValue().catch(() => '')).trim()) continue;
      const id = await ta.getAttribute('id').catch(() => '');
      const label = await getLabelText(page, id);
      if (!label) continue;
      let ans = findAnswer(label, answers);
      if (ans === null) {
        ans = guessAnswer(label);
        if (ans === null) {
          ans = await fallbackTextareaGuess(label);
          logger.info(`[Guesser] Fallback textarea guessed: "${label}" -> "${ans}"`);
        }
        if (ans !== null) {
          answers[label] = ans;
          saveAnswers(answers);
        }
      }
      if (ans !== null) {
        await ta.fill(String(ans));
      } else {
        throw new Error('UNKNOWN_QUESTION: ' + label);
      }
    } catch (err) {
      if (err.message.includes('UNKNOWN_QUESTION')) throw err;
    }
  }

  // Selects
  for (const sel of await page.locator('select').all()) {
    try {
      if (!await sel.isVisible({ timeout: 300 })) continue;
      const cur = await sel.inputValue().catch(() => '');
      if (cur && cur !== 'Select an option') continue;
      const id = await sel.getAttribute('id').catch(() => '');
      const label = await getLabelText(page, id);
      if (!label) continue;
      let ans = findAnswer(label, answers);
      if (ans === null) {
        ans = guessAnswer(label);
        if (ans !== null) {
          logger.info(`[Guesser] Guessed: "${label}" -> "${ans}"`);
          answers[label] = ans;
          saveAnswers(answers);
        }
      }

      // Try selecting by label or value or fuzzy matching
      const options = await sel.locator('option').all();
      let selected = false;

      if (ans !== null) {
        // 1. Try exact label select
        try {
          await sel.selectOption({ label: ans });
          selected = true;
        } catch {}

        // 2. Try fuzzy matching option texts
        if (!selected) {
          for (let i = 0; i < options.length; i++) {
            const text = (await options[i].textContent().catch(() => '')).trim().toLowerCase();
            if (text.includes(String(ans).toLowerCase())) {
              try {
                await sel.selectOption({ index: i });
                selected = true;
                break;
              } catch {}
            }
          }
        }
      }

      // 3. Fallback to first non-empty option if not selected yet
      if (!selected) {
        for (let i = 0; i < options.length; i++) {
          const text = (await options[i].textContent().catch(() => '')).trim().toLowerCase();
          if (text && !text.includes('select an') && !text.includes('choose')) {
            try {
              await sel.selectOption({ index: i });
              selected = true;
              const val = (await options[i].textContent().catch(() => '')).trim();
              logger.info(`[Guesser] Fallback selected option index ${i} ("${val}") for: "${label}"`);
              answers[label] = val;
              saveAnswers(answers);
              break;
            } catch {}
          }
        }
      }

      if (!selected) {
        throw new Error('UNKNOWN_QUESTION: ' + label);
      }
    } catch (err) {
      if (err.message.includes('UNKNOWN_QUESTION')) throw err;
    }
  }

  // Radio groups
  for (const group of await page.locator('fieldset,[role="radiogroup"]').all()) {
    try {
      if (!await group.isVisible({ timeout: 300 })) continue;
      if (await group.locator('input[type="radio"]:checked').count() > 0) continue;
      const legend = await group.locator('legend,.fb-dash-form-element__label,label').first().textContent().catch(() => '');
      if (!legend.trim()) continue;
      let ans = findAnswer(legend.trim(), answers);
      if (ans === null) {
        ans = guessAnswer(legend.trim());
        if (ans !== null) {
          logger.info(`[Guesser] Guessed: "${legend.trim()}" -> "${ans}"`);
          answers[legend.trim()] = ans;
          saveAnswers(answers);
        }
      }
      const radios = await group.locator('input[type="radio"]').all();
      if (radios.length === 0) continue;
      if (ans !== null) {
        let clicked = false;
        for (const r of radios) {
          const lbl = await r.locator('xpath=../label|../../label').first().textContent().catch(() => '');
          if (lbl.toLowerCase().includes(String(ans).toLowerCase())) { await r.click(); clicked = true; break; }
        }
        if (!clicked) await radios[0].click();
      } else {
        throw new Error('UNKNOWN_QUESTION: ' + legend.trim());
      }
    } catch (err) {
      if (err.message.includes('UNKNOWN_QUESTION')) throw err;
    }
  }
}

async function handleEasyApplyModal(page, jobTitle, jobCompany) {
  const answers = loadAnswers();
  await page.waitForTimeout(1500);

  try {
    for (let step = 1; step <= 10; step++) {
      logger.info(`[Apply] Step ${step}: ${jobTitle} @ ${jobCompany}`);
      await fillFormStep(page, answers);
      await page.waitForTimeout(600);

      // Submit?
      const submitBtn = page.locator('button[aria-label="Submit application"],button:has-text("Submit application")');
      if (await submitBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.first().click();
        await page.waitForTimeout(3000);
        logger.success(`[Apply] ✅ Submitted: ${jobTitle} @ ${jobCompany}`);
        // Dismiss post-apply modal
        try {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
          const discard = page.locator('button:has-text("Discard")');
          if (await discard.first().isVisible({ timeout: 1500 })) await discard.first().click();
        } catch {}
        return 'applied';
      }

      // Next / Review / Continue?
      const nextSel = [
        'button[aria-label="Continue to next step"]',
        'button[aria-label="Review your application"]',
        'button:has-text("Next")',
        'button:has-text("Review")',
        'button:has-text("Continue")',
      ].join(', ');

      const nextBtn = page.locator(nextSel);
      if (await nextBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextBtn.first().click();
        await page.waitForTimeout(1200);
        continue;
      }

      // Nothing found — bail
      logger.warn(`[Apply] No Next/Submit at step ${step} — aborting`);
      await dismissModal(page);
      return 'failed';
    }
  } catch (err) {
    if (err.message.includes('UNKNOWN_QUESTION')) {
      logger.warn(`[Apply] Skipping job (unknown question: "${err.message.split('UNKNOWN_QUESTION: ')[1]}")`);
    } else {
      logger.error(`[Apply] Error in form filling: ${err.message}`);
    }
    await dismissModal(page);
    return 'failed';
  }
  return 'failed';
}

async function dismissModal(page) {
  try {
    let closed = false;
    // 1. Try clicking close/X buttons
    const closeBtnSelectors = [
      'button.artdeco-modal__dismiss',
      'button[data-test-modal-close-btn]',
      'button[aria-label="Dismiss"]',
      'button[aria-label="Close"]',
    ];
    for (const sel of closeBtnSelectors) {
      const btn = page.locator(sel);
      if (await btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.first().click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
        closed = true;
        break;
      }
    }

    // 2. Try Escape key
    if (!closed) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // 3. Try to click "Discard" button in the confirmation modal
    const discardBtnSelectors = [
      'button:has-text("Discard")',
      'button[data-control-name="discard_application_confirm_btn"]',
      'span:has-text("Discard")',
    ];
    for (const sel of discardBtnSelectors) {
      const btn = page.locator(sel);
      if (await btn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.first().click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
        break;
      }
    }
  } catch (err) {
    logger.warn(`[Apply] Error dismissing modal: ${err.message}`);
  }
}

function getDailyRandomCap() {
  const dateStr = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const min = 34;
  const max = 40;
  return min + Math.abs(hash % (max - min + 1));
}

async function main(applyLimit = null) {
  console.log('\n\x1b[1m\x1b[34m╔══════════════════════════════════════════════════════════╗');
  console.log('║      LinkedIn Auto-Apply Bot — Right-Pane Apply Mode       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

  if (!fs.existsSync(SESSION_PATH)) { logger.error('No session. Run `npm run login`.'); process.exit(1); }
  if (!fs.existsSync(RESUME_PATH)) logger.warn(`Resume not found at ${RESUME_PATH}`);

  const dailyCap = profile.daily_application_cap || 50;
  const appliedToday = countAppliedToday();
  const currentHour = new Date().getHours();

  // Calculate targeted quota based on time of day:
  // Before 3 PM (15:00), target is half of the daily cap (e.g. 25)
  // After 3 PM (15:00), target is the full daily cap (e.g. 50)
  let targetCount = dailyCap;
  if (applyLimit === null) {
    if (currentHour < 15) {
      targetCount = Math.floor(dailyCap / 2);
    }
  } else {
    targetCount = Math.min(dailyCap, appliedToday + applyLimit);
  }

  let cap = targetCount - appliedToday;
  logger.info(`[Main] Daily Cap: ${dailyCap} | Today's Target: ${targetCount} | Applied Today: ${appliedToday} | Remaining for this run: ${cap}`);
  if (cap <= 0) { logger.warn('[Main] Quota or run limit already reached for this time slot.'); return; }

  // Check internet first
  const online = await waitForInternet();
  if (!online) {
    logger.error('[Main] Internet is disconnected. Exiting run.');
    return;
  }

  let browser, context;
  async function shutdown() {
    logger.summary();
    try { if (context) await context.storageState({ path: SESSION_PATH }); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }

  try {
    browser = await chromium.launch({ headless: false, slowMo: 50 });
    context = await browser.newContext({
      storageState: SESSION_PATH,
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Verify session
    await page.goto(`${BASE}/feed/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);
    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      logger.error('Session expired. Run `npm run login`.'); await shutdown(); return;
    }
    logger.success('[Main] Session valid ✅\n');

    const seenIds = new Set();
    const total = profile.role_titles.length * SEARCH_LOCATIONS.length;
    let combo = 0;

    outer:
    for (const role of profile.role_titles) {
      for (const location of SEARCH_LOCATIONS) {
        if (cap <= 0) break outer;
        combo++;
        logger.info(`[Search] Combo ${combo}/${total}: "${role}" in "${location}"`);

        try {
          await page.goto(buildSearchUrl(role, location), { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForTimeout(3000);

          // Wait for job cards
          try { await page.waitForSelector('li[data-occludable-job-id]', { timeout: 20_000 }); }
          catch { logger.warn('[Search] No cards found'); continue; }

          // Scroll to load all cards
          await page.evaluate(() => {
            const l = document.querySelector('.jobs-search-results-list') || document.querySelector('[class*="results-list"]');
            if (l) l.scrollTop = l.scrollHeight; else window.scrollTo(0, 800);
          });
          await page.waitForTimeout(1500);

          const jobIds = await page.evaluate(() =>
            [...document.querySelectorAll('li[data-occludable-job-id]')]
              .map(li => li.dataset.occludableJobId).filter(Boolean)
          );
          logger.info(`[Search] ${jobIds.length} cards`);

          for (const jobId of jobIds) {
            if (cap <= 0) break outer;
            if (seenIds.has(jobId)) continue;
            seenIds.add(jobId);

            const jobUrl = `${BASE}/jobs/view/${jobId}/`;
            if (isAlreadyApplied(jobUrl)) { logger.warn(`[Skip] Already applied: ${jobId}`); continue; }

            // Click the card to load right pane
            try {
              const card = page.locator(`li[data-occludable-job-id="${jobId}"]`);
              await card.scrollIntoViewIfNeeded();
              await card.click();
              await page.waitForTimeout(2000);
            } catch { continue; }

            // Read title + company from right pane
            const title = await page.locator('.job-details-jobs-unified-top-card__job-title').first().textContent().catch(() => jobId);
            const company = await page.locator('.job-details-jobs-unified-top-card__company-name').first().textContent().catch(() => '?');
            const cleanTitle = title?.trim().replace(/\s+/g, ' ') || jobId;
            const cleanCompany = company?.trim() || '?';

            // Skip intern / trainee roles (user wants full-time only)
            const tLow = cleanTitle.toLowerCase();
            const INTERN_WORDS = ['intern', 'internship', 'trainee', 'apprentice'];
            if (INTERN_WORDS.some(w => tLow.includes(w))) {
              logger.warn(`[Skip] Intern: ${cleanTitle}`);
              continue;
            }

            // Skip senior roles
            if (profile.deprioritize_if_mentions.some(p => tLow.includes(p.toLowerCase()))) {
              logger.warn(`[Skip] Senior: ${cleanTitle}`);
              continue;
            }

            // Skip tester, wordpress developer, sap developer roles
            const skipKeywords = ['tester', 'testing', 'wordpress'];
            if (skipKeywords.some(w => tLow.includes(w))) {
              logger.warn(`[Skip] Excluded role type (tester/wordpress): ${cleanTitle}`);
              continue;
            }
            const skipExactKeywords = ['qa', 'sap'];
            if (skipExactKeywords.some(w => new RegExp(`\\b${w}\\b`, 'i').test(tLow))) {
              logger.warn(`[Skip] Excluded role type (qa/sap): ${cleanTitle}`);
              continue;
            }

            // Match only core skills or role titles
            const roleTitles = (profile.role_titles || []).map(r => r.toLowerCase());
            const coreSkills = (profile.core_skills || []).map(s => s.toLowerCase());

            const allowedKeywords = new Set();
            roleTitles.forEach(r => allowedKeywords.add(r));
            coreSkills.forEach(s => allowedKeywords.add(s));

            // Add common breakdowns / aliases for robust matching
            allowedKeywords.add('fullstack');
            allowedKeywords.add('full-stack');
            allowedKeywords.add('sde');
            allowedKeywords.add('backend');
            allowedKeywords.add('back-end');
            allowedKeywords.add('node');
            allowedKeywords.add('express');
            allowedKeywords.add('mongo');
            allowedKeywords.add('mern');

            const titleMatch = Array.from(allowedKeywords).some(kw => {
              if (kw.length <= 3) {
                return new RegExp(`\\b${kw}\\b`, 'i').test(tLow);
              }
              return tLow.includes(kw);
            });

            if (!titleMatch) {
              logger.warn(`[Skip] Title does not match core skills or roles: ${cleanTitle}`);
              continue;
            }


            // Check Easy Apply button in right pane
            const easyBtn = page.locator(EASY_APPLY_BTN).first();
            const btnVisible = await easyBtn.isVisible({ timeout: 8000 }).catch(() => false);
            if (!btnVisible) {
              logger.warn(`[Skip] No Easy Apply button: ${cleanTitle} @ ${cleanCompany}`);
              continue;
            }

            // Check if the button is disabled
            const btnEnabled = await easyBtn.isEnabled().catch(() => false);
            const classAttr = await easyBtn.getAttribute('class').catch(() => '');
            if (!btnEnabled || classAttr.includes('disabled')) {
              logger.warn(`[Skip] Easy Apply button is disabled: ${cleanTitle} @ ${cleanCompany}`);
              continue;
            }

            logger.info(`[Apply] → "${cleanTitle}" @ ${cleanCompany}`);

            await easyBtn.click();
            const result = await handleEasyApplyModal(page, cleanTitle, cleanCompany);

            const job = { title: cleanTitle, company: cleanCompany, url: jobUrl, score: 1.0 };
            if (result === 'applied') {
              cap--;
              recordApplication(job, 'applied');
              logger.record('applied', { ...job, followers: null });
              if (cap > 0) {
                const delay = 5000 + Math.random() * 10000;
                logger.info(`[Main] Waiting ${(delay/1000).toFixed(1)}s...`);
                await page.waitForTimeout(delay);
              }
            } else {
              recordApplication(job, 'failed', 'apply failed');
              logger.record('failed', { ...job, followers: null }, 'apply failed');
            }

            // Verify if modal is still open, reload page if stuck
            const modalOpen = await page.locator('.artdeco-modal, [role="dialog"]').first().isVisible({ timeout: 1500 }).catch(() => false);
            if (modalOpen) {
              logger.warn('[Main] Modal still open after dismissal — reloading page to recover...');
              await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
              await page.waitForTimeout(4000);
              // Scroll list again to lazy load cards
              await page.evaluate(() => {
                const l = document.querySelector('.jobs-search-results-list') || document.querySelector('[class*="results-list"]');
                if (l) l.scrollTop = l.scrollHeight;
              });
              await page.waitForTimeout(2000);
            }
          }
        } catch (err) {
          if (err.message?.includes('closed') || err.message?.includes('Target page')) {
            logger.warn('[Main] Browser closed.'); break outer;
          }
          logger.error(`[Search] Combo ${combo} error: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logger.error(`[Main] Fatal: ${err.message}`);
  }

  await shutdown();

}

if (require.main === module) {
  main();
}

module.exports = { runBot: main };
