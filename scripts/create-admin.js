// Usage: npm run create-admin -- "Full Name" email@company.com "password"
// Creates an admin, or resets the password and admin role of an existing account with that email.
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { now } = require('../src/util');
const { passwordProblems } = require('../src/password');

async function main() {
  const [name, emailArg, password] = process.argv.slice(2);
  if (!name || !emailArg || !password) {
    console.error('Usage: npm run create-admin -- "Full Name" email@company.com "password"');
    process.exit(1);
  }
  const problems = passwordProblems(password, { email: emailArg, name });
  if (problems.length) {
    console.error(`Password must have ${problems.join(', ')}.`);
    process.exit(1);
  }
  const email = emailArg.toLowerCase();
  await db.init();
  const hash = await bcrypt.hash(password, 11);
  const existing = await db.one('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    await db.query("UPDATE users SET name = ?, password_hash = ?, role = 'admin', company_id = NULL, is_active = 1 WHERE id = ?", [
      name,
      hash,
      existing.id,
    ]);
    console.log(`Updated ${email} - now an admin with the new password.`);
  } else {
    await db.query(
      "INSERT INTO users (name, email, password_hash, role, is_active, notify_email, created_at) VALUES (?, ?, ?, 'admin', 1, 1, ?)",
      [name, email, hash, now()]
    );
    console.log(`Created admin ${email}.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
