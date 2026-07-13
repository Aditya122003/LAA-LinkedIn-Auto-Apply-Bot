/**
 * logger.js — Structured logging to console + log file, with run summary.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, `run_${new Date().toISOString().slice(0, 10)}.log`);

// Ensure log dir exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// In-memory stats for the current run
const stats = {
  applied: [],
  skipped: [],
  failed: [],
};

/** Append a line to the log file */
function writeToFile(line) {
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

/** Format a timestamp */
function ts() {
  return new Date().toISOString();
}

/** Generic info log */
function info(msg) {
  const line = `[${ts()}] [INFO] ${msg}`;
  console.log(`\x1b[36m${line}\x1b[0m`);
  writeToFile(line);
}

/** Success log */
function success(msg) {
  const line = `[${ts()}] [OK]   ${msg}`;
  console.log(`\x1b[32m${line}\x1b[0m`);
  writeToFile(line);
}

/** Warning log */
function warn(msg) {
  const line = `[${ts()}] [WARN] ${msg}`;
  console.log(`\x1b[33m${line}\x1b[0m`);
  writeToFile(line);
}

/** Error log */
function error(msg) {
  const line = `[${ts()}] [ERR]  ${msg}`;
  console.log(`\x1b[31m${line}\x1b[0m`);
  writeToFile(line);
}

/**
 * Record an application attempt.
 * @param {'applied'|'skipped'|'failed'} status
 * @param {Object} job - { title, company, followers, score, url }
 * @param {string} [reason]
 */
function record(status, job, reason = '') {
  const entry = {
    timestamp: ts(),
    status,
    title: job.title,
    company: job.company,
    followers: job.followers ?? 'N/A',
    score: job.score !== undefined ? job.score.toFixed(3) : 'N/A',
    url: job.url,
    reason,
  };

  stats[status]?.push(entry);

  const reasonStr = reason ? ` | ${reason}` : '';
  const msg = `[${status.toUpperCase()}] "${job.title}" @ ${job.company} | followers=${entry.followers} | score=${entry.score}${reasonStr} | ${job.url}`;

  if (status === 'applied') success(msg);
  else if (status === 'skipped') warn(msg);
  else error(msg);

  writeToFile(`[${ts()}] [RECORD] ${JSON.stringify(entry)}`);
}

/** Print end-of-run summary to console and log file */
function summary() {
  const divider = '═'.repeat(60);
  const lines = [
    '',
    divider,
    '                  RUN SUMMARY',
    divider,
    `  ✅ Applied  : ${stats.applied.length}`,
    `  ⏭️  Skipped  : ${stats.skipped.length}`,
    `  ❌ Failed   : ${stats.failed.length}`,
    divider,
  ];

  if (stats.applied.length > 0) {
    lines.push('  Applied jobs:');
    stats.applied.forEach((j, i) => {
      lines.push(`    ${i + 1}. ${j.title} @ ${j.company} (score: ${j.score})`);
    });
    lines.push(divider);
  }

  if (stats.failed.length > 0) {
    lines.push('  Failed / Needs Review:');
    stats.failed.forEach((j, i) => {
      lines.push(`    ${i + 1}. ${j.title} @ ${j.company} — ${j.reason}`);
    });
    lines.push(divider);
  }

  lines.push('');
  const output = lines.join('\n');
  console.log(output);
  writeToFile(output);
}

module.exports = { info, success, warn, error, record, summary };
