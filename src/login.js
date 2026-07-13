/**
 * login.js — One-time LinkedIn login script.
 *
 * Opens a HEADED browser window so YOU can type your credentials manually.
 * Once LinkedIn's feed loads, the session is saved to session/storageState.json.
 * Credentials are NEVER touched by code — you type them yourself in the browser.
 *
 * Usage: npm run login
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_PATH = path.resolve(__dirname, '../session/storageState.json');
const SESSION_DIR = path.dirname(SESSION_PATH);

async function login() {
  // Ensure session directory exists
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  console.log('\n🚀 Opening LinkedIn login page...');
  console.log('👉 Please log in manually in the browser window that appears.');
  console.log('⏳ Waiting for you to reach the LinkedIn feed...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null, // Use full window size
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  // Poll every 2 seconds for up to 3 minutes until logged in
  console.log('🔍 Watching for successful login...');
  console.log('   (Log in, then wait — browser will close automatically)\n');

  const deadline = Date.now() + 3 * 60 * 1000;
  let loggedIn = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url();

    // Any page that is NOT the login or checkpoint page = success
    if (
      !url.includes('/login') &&
      !url.includes('/checkpoint') &&
      !url.includes('/authwall') &&
      url.includes('linkedin.com')
    ) {
      loggedIn = true;
      break;
    }
  }

  if (!loggedIn) {
    console.error('\n❌ Timed out waiting for login. Please try again.');
    await browser.close();
    process.exit(1);
  }

  console.log('\n✅ Login detected! Saving session...');

  // Save storage state (cookies + localStorage)
  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved to: ${SESSION_PATH}`);
  console.log('🎉 You can now run the bot with: npm start\n');

  await browser.close();
}

login().catch((err) => {
  console.error('Login script failed:', err.message);
  process.exit(1);
});
