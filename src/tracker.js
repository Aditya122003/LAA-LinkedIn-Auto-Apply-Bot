/**
 * tracker.js — Daily application cap + deduplication via applied_jobs.json
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../logs');
const APPLIED_FILE = path.join(LOG_DIR, 'applied_jobs.json');
const EXCEL_DIR = path.resolve(__dirname, '../excel');

/** Load the applied jobs log (creates empty file if missing) */
function loadLog() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(APPLIED_FILE)) fs.writeFileSync(APPLIED_FILE, '[]', 'utf8');
  try {
    return JSON.parse(fs.readFileSync(APPLIED_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/** Save the applied jobs log */
function saveLog(entries) {
  fs.writeFileSync(APPLIED_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

/** Get today's ISO date string (YYYY-MM-DD) */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Count how many jobs have been applied today.
 * @returns {number}
 */
function countAppliedToday() {
  const log = loadLog();
  const t = today();
  return log.filter((e) => e.date === t && e.status === 'applied').length;
}

/**
 * Check if a job URL has already been applied to.
 * @param {string} url
 * @returns {boolean}
 */
function isAlreadyApplied(url) {
  const log = loadLog();
  return log.some((e) => e.url === url && e.status === 'applied');
}

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

function appendToDailyExcel(job) {
  try {
    if (!fs.existsSync(EXCEL_DIR)) {
      fs.mkdirSync(EXCEL_DIR, { recursive: true });
    }
    const tStr = today();
    const csvFile = path.join(EXCEL_DIR, `applied_jobs_${tStr}.csv`);
    const isNew = !fs.existsSync(csvFile);

    const headers = '"Date","Timestamp","Company","Job Title","Job URL"\n';
    const row = `${escapeCsvField(tStr)},${escapeCsvField(new Date().toISOString())},${escapeCsvField(job.company)},${escapeCsvField(job.title)},${escapeCsvField(job.url)}\n`;

    if (isNew) {
      fs.writeFileSync(csvFile, headers + row, 'utf8');
    } else {
      fs.appendFileSync(csvFile, row, 'utf8');
    }
  } catch (err) {
    console.error('[Tracker] Error writing to CSV:', err.message);
  }
}

/**
 * Record a job application.
 * @param {Object} job - { title, company, url, score }
 * @param {'applied'|'skipped'|'failed'} status
 * @param {string} [reason]
 */
function recordApplication(job, status, reason = '') {
  const log = loadLog();
  log.push({
    date: today(),
    timestamp: new Date().toISOString(),
    title: job.title,
    company: job.company,
    url: job.url,
    score: job.score,
    status,
    reason,
  });
  saveLog(log);

  if (status === 'applied') {
    appendToDailyExcel(job);
  }
}

module.exports = { countAppliedToday, isAlreadyApplied, recordApplication };
