// ── Credential Setup Script ───────────────────────────────────────────────
// Run once to hash the admin password and generate a JWT secret.
// Appends the results to .env — never stores the plaintext password.
//
// Usage:
//   npm run setup-creds
//
// What it does:
//   1. Prompts for username and password (input is echoed — run in a private terminal)
//   2. Hashes the password with bcrypt (cost factor 12 — ~400ms, safe for 2026+)
//   3. Generates a cryptographically random 48-byte JWT secret
//   4. Appends AUTH_USERNAME, AUTH_PASSWORD_HASH, JWT_SECRET to .env
//      (skips any var that is already present to avoid overwriting)

import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n⚡  SSEN Substation Tool — Credential Setup');
  console.log('    This script runs once. Plaintext password is not stored anywhere.\n');

  const existingEnv = existsSync('.env') ? readFileSync('.env', 'utf-8') : '';

  const username = (await ask('  Username [TestUser]: ')).trim() || 'TestUser';
  const password = (await ask('  Password: ')).trim();

  if (!password) {
    console.error('\n  ✗  Password cannot be empty.\n');
    process.exit(1);
  }

  console.log('\n  Hashing password (bcrypt cost 12) — this takes ~1 second...');
  const hash = await bcrypt.hash(password, 12);

  const jwtSecret = randomBytes(48).toString('hex');

  // Build lines to append — skip vars already present
  const toAppend = [];

  if (!existingEnv.includes('AUTH_USERNAME=')) {
    toAppend.push(`AUTH_USERNAME=${username}`);
  } else {
    console.log('  ℹ  AUTH_USERNAME already in .env — skipped');
  }

  if (!existingEnv.includes('AUTH_PASSWORD_HASH=')) {
    toAppend.push(`AUTH_PASSWORD_HASH=${hash}`);
  } else {
    // Overwrite the existing hash (e.g. changing password)
    const updated = existingEnv.replace(/^AUTH_PASSWORD_HASH=.*/m, `AUTH_PASSWORD_HASH=${hash}`);
    writeFileSync('.env', updated);
    console.log('  ✔  AUTH_PASSWORD_HASH updated in .env');
  }

  if (!existingEnv.includes('JWT_SECRET=')) {
    toAppend.push(`JWT_SECRET=${jwtSecret}`);
  } else {
    console.log('  ℹ  JWT_SECRET already in .env — skipped (existing sessions remain valid)');
  }

  if (toAppend.length > 0) {
    const block = '\n' + toAppend.join('\n') + '\n';
    if (existsSync('.env')) {
      appendFileSync('.env', block);
    } else {
      writeFileSync('.env', block.trimStart());
    }
    toAppend.forEach(line => {
      const key = line.split('=')[0];
      console.log(`  ✔  ${key} written to .env`);
    });
  }

  console.log('\n  Done. Next steps:');
  console.log('  1. Ensure ANTHROPIC_API_KEY=sk-ant-... is in .env');
  console.log('  2. npm run dev:server   (development)');
  console.log('  3. npm run build && npm run server   (production)\n');

  rl.close();
}

main().catch(e => {
  console.error('\n  ✗  Setup failed:', e.message, '\n');
  process.exit(1);
});
