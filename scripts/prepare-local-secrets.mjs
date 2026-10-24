import { readFile, appendFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

const path = '.dev.vars';
let contents;
try { contents = await readFile(path, 'utf8'); }
catch (error) { if (error.code === 'ENOENT') process.exit(0); throw error; }
const existing = parseEnv(contents);
const additions = ['BETTER_AUTH_SECRET', 'SETTINGS_ENCRYPTION_KEY']
  .filter((key) => !existing[key]?.trim())
  .map((key) => `${key}=${randomBytes(32).toString('hex')}`);
if (additions.length) {
  await appendFile(path, `\n# Local authentication and encrypted dashboard settings\n${additions.join('\n')}\n`);
  await chmod(path, 0o600);
  console.log('Initialized local authentication and settings secrets. Values were not printed.');
}
