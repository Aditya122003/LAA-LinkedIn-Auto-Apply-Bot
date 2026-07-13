/**
 * apply.js — Easy Apply form handler.
 *
 * - Fills standard fields using page.evaluate() + targeted selectors
 * - Uploads resume from profile.resume_file_path
 * - Unknown screening question → terminal pause → saved to answers.json
 * - NO prompts except truly unknown questions
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const logger = require('./logger');

const ANSWERS_FILE = path.resolve(__dirname, '../config/answers.json');
const RESUME_PATH = path.resolve(__dirname, '../resume/Aditya_Resume.pdf');

function loadAnswers() {
  try {
    return JSON.parse(fs.readFileSync(ANSWERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAnswers(answers) {
  fs.writeFileSync(ANSWERS_FILE, JSON.stringify(answers, null, 2), 'utf8');
}

/**
 * Find the best matching saved answer — exact then substring.
 */
function findAnswer(question, answers) {
  const q = question.toLowerCase().trim();
  for (const [key, val] of Object.entries(answers)) {
    if (key.toLowerCase().trim() === q) return val;
  }
  for (const [key, val] of Object.entries(answers)) {
    const k = key.toLowerCase().trim();
    if (q.includes(k) || k.includes(q)) return val;
  }
  return null;
}

/**
 * Pause and ask user in terminal — ONLY used for truly unknown questions.
 */
function promptUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log('\n\x1b[35m╔══════════════════════════════════════════════════════════╗');
    console.log('║           ⚠️  UNKNOWN SCREENING QUESTION                  ║');
    console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m');
    console.log(`\x1b[33mQuestion:\x1b[0m ${question}`);
    rl.question('\x1b[36mYour answer: \x1b[0m', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Get the label text for a form element by its id attribute.
 */
async function getLabelText(page, id) {
  if (!id) return '';
  return await page.evaluate((elId) => {
    const label = document.querySelector(`label[for="${elId}"]`);
    if (label) return label.textContent?.trim() || '';
    // Try aria-labelledby
    const el = document.getElementById(elId);
    if (el) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        return labelEl?.textContent?.trim() || '';
      }
      return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }
    return '';
  }, id);
}

/**
 * Fill a single Easy Apply form step.
 * Returns list of any question labels that had no answer (for logging).
 */
async function fillFormStep(page, answers) {
  await page.waitForTimeout(1200);

  // ── Resume upload ──────────────────────────────────────────────────────────
  const fileInputs = await page.locator('input[type="file"]').all();
  for (const fi of fileInputs) {
    try {
      if (await fi.isVisible({ timeout: 1000 })) {
        if (fs.existsSync(RESUME_PATH)) {
          logger.info('[Apply] Uploading resume...');
          await fi.setInputFiles(RESUME_PATH);
          await page.waitForTimeout(1500);
        } else {
          logger.warn('[Apply] Resume file not found — skipping upload');
        }
      }
    } catch { /* skip */ }
  }

  // ── Text / number / tel / email inputs ────────────────────────────────────
  const textInputs = await page
    .locator('input[type="text"], input[type="number"], input[type="email"], input[type="tel"]')
    .all();

  for (const input of textInputs) {
    try {
      if (!(await input.isVisible({ timeout: 500 }))) continue;

      // Skip pre-filled inputs
      const currentVal = await input.inputValue().catch(() => '');
      if (currentVal.trim().length > 0) continue;

      const id = await input.getAttribute('id').catch(() => '');
      const label = await getLabelText(page, id);
      if (!label) continue;

      const answer = findAnswer(label, answers);
      if (answer !== null) {
        await input.fill(String(answer));
      } else {
        const userAnswer = await promptUser(label);
        answers[label] = userAnswer;
        saveAnswers(answers);
        await input.fill(userAnswer);
      }
    } catch { /* skip */ }
  }

  // ── Textarea fields ────────────────────────────────────────────────────────
  const textareas = await page.locator('textarea').all();
  for (const ta of textareas) {
    try {
      if (!(await ta.isVisible({ timeout: 500 }))) continue;
      const currentVal = await ta.inputValue().catch(() => '');
      if (currentVal.trim().length > 0) continue;

      const id = await ta.getAttribute('id').catch(() => '');
      const label = await getLabelText(page, id);
      if (!label) continue;

      const answer = findAnswer(label, answers);
      if (answer !== null) {
        await ta.fill(String(answer));
      } else {
        const userAnswer = await promptUser(label);
        answers[label] = userAnswer;
        saveAnswers(answers);
        await ta.fill(userAnswer);
      }
    } catch { /* skip */ }
  }

  // ── Select / dropdown fields ──────────────────────────────────────────────
  const selects = await page.locator('select').all();
  for (const sel of selects) {
    try {
      if (!(await sel.isVisible({ timeout: 500 }))) continue;
      const currentVal = await sel.inputValue().catch(() => '');
      if (currentVal && currentVal !== 'Select an option') continue;

      const id = await sel.getAttribute('id').catch(() => '');
      const label = await getLabelText(page, id);
      if (!label) continue;

      let answer = findAnswer(label, answers);
      if (answer === null) {
        answer = await promptUser(label);
        answers[label] = answer;
        saveAnswers(answers);
      }

      // Try to select by label text, fallback to first non-empty option
      try {
        await sel.selectOption({ label: answer });
      } catch {
        try {
          // Partial match
          const options = await sel.locator('option').all();
          let matched = false;
          for (const opt of options) {
            const text = (await opt.textContent() ?? '').toLowerCase();
            if (text.includes(answer.toLowerCase())) {
              const val = await opt.getAttribute('value');
              await sel.selectOption({ value: val });
              matched = true;
              break;
            }
          }
          if (!matched) await sel.selectOption({ index: 1 }); // pick first real option
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // ── Radio groups ──────────────────────────────────────────────────────────
  const radioGroups = await page.locator('fieldset, [role="radiogroup"]').all();
  for (const group of radioGroups) {
    try {
      if (!(await group.isVisible({ timeout: 500 }))) continue;

      // Already answered?
      const anyChecked = await group.locator('input[type="radio"]:checked').count();
      if (anyChecked > 0) continue;

      const legendText = await group
        .locator('legend, .fb-dash-form-element__label, label')
        .first()
        .textContent()
        .catch(() => '');
      const label = legendText.trim();
      if (!label) continue;

      let answer = findAnswer(label, answers);
      if (answer === null) {
        answer = await promptUser(label);
        answers[label] = answer;
        saveAnswers(answers);
      }

      // Find the radio whose label matches the answer
      const radios = await group.locator('input[type="radio"]').all();
      let clicked = false;
      for (const radio of radios) {
        try {
          const radioLabel = await radio
            .locator('xpath=./following-sibling::*[1]|../label|../../label')
            .first()
            .textContent()
            .catch(() => '');
          if (radioLabel.toLowerCase().includes(answer.toLowerCase())) {
            await radio.click();
            clicked = true;
            break;
          }
        } catch { /* skip */ }
      }
      // Fallback: click "Yes" radio or first radio
      if (!clicked && radios.length > 0) {
        for (const radio of radios) {
          const val = await radio.getAttribute('value').catch(() => '');
          if (val?.toLowerCase() === 'yes' || val?.toLowerCase() === 'true') {
            await radio.click();
            clicked = true;
            break;
          }
        }
        if (!clicked) await radios[0].click();
      }
    } catch { /* skip */ }
  }
}

/**
 * Main apply function — handles the full Easy Apply multi-step modal.
 * @returns {Promise<'applied'|'failed'>}
 */
async function applyToJob(page, job) {
  const answers = loadAnswers();

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for the Easy Apply button to actually render (React hydration takes time)
    const BTN_SELECTOR = [
      'button.jobs-apply-button',
      'button[aria-label*="Easy Apply"]',
      '.jobs-s-apply button',
    ].join(', ');

    let easyApplyClicked = false;
    try {
      await page.waitForSelector(BTN_SELECTOR, { timeout: 15_000 });
      const btn = page.locator(BTN_SELECTOR);
      await btn.first().click();
      easyApplyClicked = true;
    } catch {
      // Button didn't appear — not an Easy Apply job (despite filter), skip it
      logger.warn(`[Apply] No Easy Apply button: ${job.title} @ ${job.company} — skipping`);
      return 'failed';
    }

    await page.waitForTimeout(2000);

    // ── Multi-step form loop ─────────────────────────────────────────────────
    const MAX_STEPS = 10;

    for (let step = 1; step <= MAX_STEPS; step++) {
      logger.info(`[Apply] Step ${step} — ${job.title} @ ${job.company}`);

      await fillFormStep(page, answers);
      await page.waitForTimeout(800);

      // Check: Submit button?
      const submitSelectors = [
        'button[aria-label="Submit application"]',
        'button:has-text("Submit application")',
      ];
      for (const sel of submitSelectors) {
        try {
          const btn = page.locator(sel);
          if (await btn.first().isVisible({ timeout: 2000 })) {
            logger.info('[Apply] Clicking Submit...');
            await btn.first().click();
            await page.waitForTimeout(3000);

            // Confirm success
            const successSelectors = [
              '.jobs-post-apply-modal',
              'h3:has-text("Application submitted")',
              '.artdeco-modal__content:has-text("application was sent")',
              '[aria-label*="application was sent"]',
            ];
            let confirmed = false;
            for (const sSel of successSelectors) {
              try {
                if (await page.locator(sSel).first().isVisible({ timeout: 5000 })) {
                  confirmed = true;
                  break;
                }
              } catch { /* try next */ }
            }

            if (confirmed) {
              logger.success(`[Apply] ✅ Applied: ${job.title} @ ${job.company}`);
            } else {
              logger.warn(`[Apply] Submitted (could not confirm modal): ${job.title}`);
            }

            // Close any post-apply modal
            await dismissModal(page);
            return 'applied';
          }
        } catch { /* try next selector */ }
      }

      // Check: Next / Review / Continue button?
      const nextSelectors = [
        'button[aria-label="Continue to next step"]',
        'button[aria-label="Review your application"]',
        'button:has-text("Next")',
        'button:has-text("Review")',
        'button:has-text("Continue")',
      ];

      let advanced = false;
      for (const sel of nextSelectors) {
        try {
          const btn = page.locator(sel);
          if (await btn.first().isVisible({ timeout: 2000 })) {
            await btn.first().click();
            await page.waitForTimeout(1500);
            advanced = true;
            break;
          }
        } catch { /* try next */ }
      }

      if (!advanced) {
        logger.error(`[Apply] No Next/Submit button at step ${step} for: ${job.title}`);
        await dismissModal(page);
        return 'failed';
      }
    }

    logger.error(`[Apply] Exceeded max steps for: ${job.title}`);
    return 'failed';

  } catch (err) {
    logger.error(`[Apply] Exception for "${job.title}": ${err.message}`);
    await dismissModal(page).catch(() => {});
    return 'failed';
  }
}

/** Close Easy Apply modal without submitting */
async function dismissModal(page) {
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.first().isVisible({ timeout: 2000 })) {
      await discard.first().click();
    }
  } catch { /* ignore */ }
}

module.exports = { applyToJob };
