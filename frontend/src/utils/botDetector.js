/**
 * Accurately determines if an author/contributor identity is an automated bot.
 * Avoids substring false-positives (e.g. 'social' containing 'ci', or 'talbot' containing 'bot').
 */
export const isBotIdentity = (name, email) => {
  const n = (name || '').toLowerCase();
  const e = (email || '').toLowerCase();

  // 1. Explicit Git automation tag (e.g. dependabot[bot], railway-app[bot], google-labs-jules[bot])
  if (n.includes('[bot]') || e.includes('[bot]')) {
    return true;
  }

  // 2. Specific known automated service accounts
  const knownBotPatterns = [
    'dependabot',
    'github-actions',
    'google-labs-jules',
    'greenkeeper',
    'renovate',
    'snyk-bot',
    'actions-user',
    'npm-owner',
    'railway-app'
  ];
  if (knownBotPatterns.some((pattern) => n.includes(pattern) || e.includes(pattern))) {
    return true;
  }

  // 3. Regular student/personal email accounts should never be falsely flagged as bots
  if (
    e.endsWith('@students.nsbm.ac.lk') ||
    e.endsWith('@gmail.com') ||
    e.endsWith('@yahoo.com') ||
    e.endsWith('@outlook.com') ||
    e.endsWith('@hotmail.com') ||
    e.endsWith('@icloud.com')
  ) {
    return false;
  }

  // 4. Word-boundary or tokenized bot/ci detection for custom CI/automation accounts
  const tokenRegex = /(?:^|[^a-z0-9])(?:bot|ci|actions|workflow)(?:[^a-z0-9]|$)/i;
  return tokenRegex.test(n) || tokenRegex.test(e);
};
