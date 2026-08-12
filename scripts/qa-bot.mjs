#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps', 'api');
const webDir = path.join(root, 'apps', 'web');
const node = process.execPath;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const mode = argValue('--mode', process.env.QA_MODE ?? 'quick');
const strict = hasFlag('--strict') || process.env.QA_STRICT === 'true';
const runIntegration = ['ci', 'full', 'all'].includes(mode) || process.env.QA_INTEGRATION === 'true';
const runPublic = ['production', 'all'].includes(mode) || process.env.QA_PUBLIC === 'true';
const runDocker = mode === 'full' || process.env.QA_DOCKER === 'true';
const results = [];

function packageRoot(packageName, baseDir) {
  for (const candidate of [baseDir, root]) {
    const packageJson = path.join(candidate, 'package.json');
    if (!existsSync(packageJson)) continue;
    const requireFrom = createRequire(packageJson);
    try {
      return path.dirname(requireFrom.resolve(`${packageName}/package.json`));
    } catch {
      // Try the next lookup base.
    }
  }
  throw new Error(`Dependencia nao encontrada: ${packageName}. Rode npm ci antes do bot.`);
}

const prismaCli = path.join(packageRoot('prisma', apiDir), 'build', 'index.js');
const apiTsc = path.join(packageRoot('typescript', apiDir), 'bin', 'tsc');
const webTsc = path.join(packageRoot('typescript', webDir), 'bin', 'tsc');
const viteCli = path.join(packageRoot('vite', webDir), 'bin', 'vite.js');
const tsxLoader = pathToFileURL(path.join(packageRoot('tsx', apiDir), 'dist', 'loader.mjs')).href;

function commandExists(command) {
  const separator = process.platform === 'win32' ? ';' : ':';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return (process.env.PATH ?? '')
    .split(separator)
    .some((directory) => extensions.some((extension) => existsSync(path.join(directory, `${command}${extension}`))));
}

function testArgs(files) {
  return ['--import', tsxLoader, '--import', './test/setup.ts', '--test', '--test-concurrency=1', ...files];
}

function baseEnv(extra = {}) {
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://promo:promo@localhost:5432/promo_test?schema=public',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    JWT_SECRET: process.env.JWT_SECRET ?? 'test-jwt-secret-with-at-least-32-characters',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '15m',
    JWT_ISSUER: process.env.JWT_ISSUER ?? 'promotion-radar-api-test',
    JWT_AUDIENCE: process.env.JWT_AUDIENCE ?? 'promotion-radar-web-test',
    FRONTEND_ORIGINS: process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173',
    BOOTSTRAP_ADMIN_ENABLED: process.env.BOOTSTRAP_ADMIN_ENABLED ?? 'true',
    ADMIN_NAME: process.env.ADMIN_NAME ?? 'Administrador de Teste',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'admin@test.local',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'TestAdminPassword123!',
    CHANNEL_CONFIG_ENCRYPTION_KEY: process.env.CHANNEL_CONFIG_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString('base64'),
    ALLOW_INSECURE_OUTBOUND_HTTP: process.env.ALLOW_INSECURE_OUTBOUND_HTTP ?? 'false',
    COLLECT_INTERVAL_SECONDS: process.env.COLLECT_INTERVAL_SECONDS ?? '3600',
    VITE_API_URL: process.env.VITE_API_URL ?? 'https://api-ofertas.r2rmarketingdigital.com.br',
    ...extra
  };
}

async function runStep(step) {
  const startedAt = Date.now();
  const output = [];
  console.log(`\n[RUN ] ${step.name}`);

  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd ?? root,
      env: step.env ?? baseEnv(),
      shell: false
    });

    const append = (chunk, stream) => {
      const text = chunk.toString();
      output.push(text);
      stream.write(text);
    };

    child.stdout.on('data', (chunk) => append(chunk, process.stdout));
    child.stderr.on('data', (chunk) => append(chunk, process.stderr));
    child.on('error', (error) => {
      const result = {
        status: 'fail',
        name: step.name,
        durationMs: Date.now() - startedAt,
        code: null,
        output: error.message
      };
      results.push(result);
      console.log(`[FAIL] ${step.name}`);
      resolve(result);
    });
    child.on('close', (code) => {
      const status = code === 0 ? 'pass' : 'fail';
      const result = {
        status,
        name: step.name,
        durationMs: Date.now() - startedAt,
        code,
        output: output.join('').slice(-24000)
      };
      results.push(result);
      console.log(`[${status.toUpperCase().padEnd(4)}] ${step.name}`);
      resolve(result);
    });
  });
}

const unitTests = [
  'test/config.test.ts',
  'test/scoring.test.ts',
  'test/secrets.test.ts',
  'test/http.test.ts',
  'test/dispatch.test.ts',
  'test/adapters.test.ts',
  'test/affiliate.test.ts',
  'test/openApi.test.ts',
  'test/runtimeSettings.test.ts',
  'test/operationalAlerts.test.ts',
  'test/observability.test.ts'
];

const integrationTests = [
  'test/integration.test.ts',
  'test/dispatchOperations.integration.test.ts',
  'test/operationalAlerts.integration.test.ts',
  'test/observability.integration.test.ts'
];

const steps = [
  { name: 'Prisma generate', command: node, args: [prismaCli, 'generate', '--schema', 'prisma/schema.prisma'], cwd: apiDir },
  { name: 'API typecheck/build', command: node, args: [apiTsc, '-p', 'tsconfig.json'], cwd: apiDir },
  { name: 'Web typecheck', command: node, args: [webTsc, '-b'], cwd: webDir },
  { name: 'Unit tests', command: node, args: testArgs(unitTests), cwd: apiDir },
  { name: 'Observability assets', command: node, args: ['scripts/validate-observability.mjs'], cwd: root },
  { name: 'Deploy assets', command: node, args: ['scripts/validate-deploy.mjs'], cwd: root },
  { name: 'Go-live assets', command: node, args: ['scripts/validate-go-live.mjs'], cwd: root },
  { name: 'EasyPanel assets', command: node, args: ['scripts/validate-easypanel.mjs'], cwd: root },
  { name: 'Web production build', command: node, args: [viteCli, 'build'], cwd: webDir, env: baseEnv({ VITE_API_URL: process.env.VITE_API_URL ?? 'https://api-ofertas.r2rmarketingdigital.com.br' }) }
];

if (runIntegration) {
  steps.splice(1, 0, { name: 'Prisma migrate deploy', command: node, args: [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], cwd: apiDir });
  steps.splice(5, 0, { name: 'Integration tests', command: node, args: testArgs(integrationTests), cwd: apiDir });
}

if (runPublic) {
  steps.push({ name: 'Public smoke', command: node, args: ['scripts/smoke-public.mjs'], cwd: root, env: baseEnv({ STRICT_MARKETPLACES: process.env.STRICT_MARKETPLACES ?? 'false' }) });
}

if (runDocker) {
  if (commandExists('docker')) {
    steps.push({ name: 'Docker image build', command: 'docker', args: ['compose', 'build', 'api', 'worker', 'web'], cwd: root });
  } else {
    const skipped = { status: strict ? 'fail' : 'skip', name: 'Docker image build', durationMs: 0, code: null, output: 'Docker nao encontrado no PATH.' };
    results.push(skipped);
    console.log(`[${skipped.status.toUpperCase().padEnd(4)}] Docker image build - ${skipped.output}`);
  }
}

for (const step of steps) {
  const result = await runStep(step);
  if (result.status === 'fail' && strict) break;
}

const summary = {
  pass: results.filter((item) => item.status === 'pass').length,
  fail: results.filter((item) => item.status === 'fail').length,
  skip: results.filter((item) => item.status === 'skip').length
};

const report = {
  generatedAt: new Date().toISOString(),
  mode,
  strict,
  summary,
  results
};

await mkdir(path.join(root, 'qa-reports'), { recursive: true });
await writeFile(path.join(root, 'qa-reports', 'latest.json'), JSON.stringify(report, null, 2));

console.log(`\nQA Bot finalizado: ${summary.pass} passou, ${summary.fail} falhou, ${summary.skip} pulou.`);
console.log(`Relatorio: ${path.join(root, 'qa-reports', 'latest.json')}`);

if (summary.fail > 0) process.exit(1);
