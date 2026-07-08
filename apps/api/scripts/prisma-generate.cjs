const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/promo_db';

execFileSync('npx', ['prisma', 'generate'], {
  stdio: 'inherit',
  cwd: __dirname + '/..',
  shell: process.platform === 'win32'
});
