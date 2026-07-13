/**
 * scorer.js — Relevance scoring engine.
 *
 * Score formula:
 *   raw = (coreMatches * 2 + secondaryMatches * 1) / (coreSkills.length * 2 + secondarySkills.length * 1)
 *   If description matches any deprioritize_if_mentions keyword → score *= 0.4
 */

const profile = require('../config/profile.json');

const CORE = profile.core_skills.map((s) => s.toLowerCase());
const SECONDARY = profile.secondary_skills.map((s) => s.toLowerCase());
const DEPRIORITIZE = profile.deprioritize_if_mentions.map((s) => s.toLowerCase());

const MAX_SCORE = CORE.length * 2 + SECONDARY.length * 1;

/**
 * Score a job against the profile.
 * @param {Object} job - { title, description }
 * @returns {{ score: number, coreMatches: string[], secondaryMatches: string[], deprioritized: boolean }}
 */
function scoreJob(job) {
  const text = `${job.title} ${job.description}`.toLowerCase();

  const coreMatches = CORE.filter((skill) => text.includes(skill));
  const secondaryMatches = SECONDARY.filter((skill) => text.includes(skill));

  let raw = (coreMatches.length * 2 + secondaryMatches.length * 1) / MAX_SCORE;

  const deprioritized = DEPRIORITIZE.some((phrase) => text.includes(phrase));
  if (deprioritized) raw *= 0.4;

  return {
    score: Math.min(raw, 1), // cap at 1.0
    coreMatches,
    secondaryMatches,
    deprioritized,
  };
}

/**
 * Filter and rank jobs by relevance score.
 * @param {Object[]} jobs - Array of job objects from scraper
 * @returns {Object[]} Sorted by score descending, only >= min_relevance_score
 */
function rankJobs(jobs) {
  const minScore = profile.min_relevance_score;

  const scored = jobs
    .map((job) => {
      const result = scoreJob(job);
      return { ...job, ...result };
    })
    .filter((job) => job.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return scored;
}

module.exports = { scoreJob, rankJobs };
