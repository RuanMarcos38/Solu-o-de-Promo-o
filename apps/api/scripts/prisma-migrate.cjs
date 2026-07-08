const { execFileSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não encontrada. Copie .env.example para .env e configure o banco.');
  process.exit(1);
}

execFileSync('npx', ['prisma', 'migrate', 'dev'], {
  stdio: 'inherit',
  cwd: __dirname + '/..',
  shell: process.platform === 'win32'
});
