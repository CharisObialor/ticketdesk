const { HttpError } = require('./util');

// Password rule shared by every place a password is set. The client mirrors it in client/src/lib/password.ts.
const MIN_LENGTH = 10;
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty', 'qwerty123', 'qwertyuiop', 'letmein',
  'welcome', 'welcome1', 'welcome123', 'admin', 'admin123', 'admin1234', 'administrator', 'iloveyou', 'abc123',
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000', 'football', 'monkey', 'dragon',
  'sunshine', 'princess', 'trustno1', 'changeme', 'support', 'support123', 'dateheight', 'dateheight123',
]);

// Returns a list of problems; an empty list means the password is acceptable.
function passwordProblems(pw, { email, name } = {}) {
  const problems = [];
  if (typeof pw !== 'string' || pw.length < MIN_LENGTH) problems.push(`at least ${MIN_LENGTH} characters`);
  if (typeof pw !== 'string') return problems;
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('a symbol such as ! @ # or ?');
  const lower = pw.toLowerCase();
  const bare = lower.replace(/[^a-z0-9]/g, '');
  if (COMMON.has(lower) || COMMON.has(bare) || COMMON.has(bare.replace(/\d+$/, ''))) problems.push('not a commonly used password');
  const personal = [String(email || '').split('@')[0], ...String(name || '').split(/\s+/)].map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
  if (personal.some((p) => lower.includes(p))) problems.push('not contain your name or email');
  return problems;
}

function checkPassword(pw, user) {
  const problems = passwordProblems(pw, user);
  if (problems.length) throw new HttpError(400, `Password must have ${problems.join(', ')}.`);
}

module.exports = { MIN_LENGTH, passwordProblems, checkPassword };
