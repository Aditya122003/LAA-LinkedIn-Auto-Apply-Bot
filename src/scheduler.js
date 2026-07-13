const { runBot } = require('./main');
const logger = require('./logger');

// Generate random number between min and max inclusive
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let morningTime = null;
let eveningTime = null;
let emailTime = null;
let morningExecuted = false;
let eveningExecuted = false;
let emailExecuted = false;
let morningLimit = 22;
let eveningLimit = 22;

function generateDailySchedules() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Hard cap set to 40
  const dailyCap = 40;
  morningLimit = randomInt(15, 25);
  eveningLimit = dailyCap - morningLimit;

  // Schedule morning run between 10:00 AM and 2:00 PM (10:00 - 14:00)
  const morningHour = randomInt(10, 13);
  const morningMin = randomInt(0, 59);
  morningTime = { hour: morningHour, minute: morningMin };
  morningExecuted = (currentHour > morningHour || (currentHour === morningHour && currentMinute >= morningMin));

  // Schedule evening run between 4:00 PM and 4:59 PM (16:00 - 17:00)
  const eveningMin = randomInt(0, 59);
  eveningTime = { hour: 16, minute: eveningMin };
  eveningExecuted = (currentHour > 16 || (currentHour === 16 && currentMinute >= eveningMin));

  // Schedule daily email report at 11:00 PM (23:00)
  emailTime = { hour: 23, minute: 0 };
  emailExecuted = (currentHour > 23 || (currentHour === 23 && currentMinute >= 0));

  const morningAmpm = morningHour >= 12 ? 'PM' : 'AM';
  const morningDisplayHour = morningHour % 12 || 12;

  logger.info(`[Scheduler] Daily schedules generated (Total target: ${dailyCap} jobs):`);
  logger.info(` - Morning run (Limit: ${morningLimit}): ${String(morningDisplayHour).padStart(2, '0')}:${String(morningMin).padStart(2, '0')} ${morningAmpm} ${morningExecuted ? '(Already passed today)' : '(Pending)'}`);
  logger.info(` - Evening run (Limit: ${eveningLimit}): 04:${String(eveningMin).padStart(2, '0')} PM ${eveningExecuted ? '(Already passed today)' : '(Pending)'}`);
  logger.info(` - Email run:   11:00 PM ${emailExecuted ? '(Already passed today)' : '(Pending)'}`);
}

async function checkAndRun() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Reset/Regenerate schedule at midnight
  if (hour === 0 && minute === 0) {
    generateDailySchedules();
    return;
  }

  // Morning run check
  if (!morningExecuted && hour === morningTime.hour && minute === morningTime.minute) {
    morningExecuted = true;
    logger.info(`[Scheduler] Starting scheduled morning run (${morningLimit} jobs limit)...`);
    try {
      await runBot(morningLimit);
      logger.info(`[Scheduler] Finished scheduled morning run.`);
    } catch (err) {
      logger.error(`[Scheduler] Morning run error: ${err.message}`);
    }
  }

  // Evening run check
  if (!eveningExecuted && hour === eveningTime.hour && minute === eveningTime.minute) {
    eveningExecuted = true;
    logger.info(`[Scheduler] Starting scheduled evening run (${eveningLimit} jobs limit)...`);
    try {
      await runBot(eveningLimit);
      logger.info(`[Scheduler] Finished scheduled evening run.`);
    } catch (err) {
      logger.error(`[Scheduler] Evening run error: ${err.message}`);
    }
  }

  // Email report run check (Daily at 11:00 PM)
  if (!emailExecuted && hour === emailTime.hour && minute === emailTime.minute) {
    emailExecuted = true;
    logger.info(`[Scheduler] Starting scheduled daily email report...`);
    try {
      const path = require('path');
      const fs = require('fs');
      const EXCEL_DIR = path.resolve(__dirname, '../excel');
      const tStr = now.toISOString().slice(0, 10);
      const csvFile = path.join(EXCEL_DIR, `applied_jobs_${tStr}.csv`);
      if (fs.existsSync(csvFile)) {
        const { sendDailyReport } = require('./email');
        await sendDailyReport(csvFile);
        logger.info(`[Scheduler] Daily email report sent successfully.`);
      } else {
        logger.warn(`[Scheduler] No applied jobs CSV report found for today (${tStr}) to email.`);
      }
    } catch (err) {
      logger.error(`[Scheduler] Email report error: ${err.message}`);
    }
  }
}

// Start Scheduler
console.log('\n\x1b[1m\x1b[32m╔══════════════════════════════════════════════════════════╗');
console.log('║             LinkedIn Auto-Apply Bot Scheduler            ║');
console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

generateDailySchedules();

// Run check every 30 seconds
setInterval(checkAndRun, 30_000);
logger.info(`[Scheduler] Scheduler is running in background. Checking every 30 seconds...`);
