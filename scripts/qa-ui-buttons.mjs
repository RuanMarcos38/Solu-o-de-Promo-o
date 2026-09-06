#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3333').replace(/\/$/, '');
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@test.local';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'TestAdminPassword123!';
const results = [];
const buttonInventory = new Map();
const testedButtons = new Set();
const apiServerErrors = [];
const browserErrors = [];
const runId = `${Date.now()}`;

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function record(status, name, detail = '') {
  results.push({ status, name, detail });
  console.log(`[${status.toUpperCase().padEnd(4)}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function step(name, fn, { warn = false } = {}) {
  try {
    await fn();
    record('pass', name);
  } catch (error) {
    record(warn ? 'warn' : 'fail', name, error instanceof Error ? error.message : 'erro desconhecido');
  }
}

function markTested(name) {
  const key = normalize(name);
  if (key) testedButtons.add(key);
}

async function clickButton(locator, name) {
  await locator.waitFor({ state: 'visible', timeout: 12000 });
  if (await locator.isDisabled()) throw new Error(`botao desabilitado: ${name}`);
  markTested(name);
  await locator.click();
}

async function snapshotButtons(page, label) {
  const buttons = await page.locator('button:visible').evaluateAll((nodes) => nodes.map((node) => {
    const aria = node.getAttribute('aria-label');
    const text = (aria || node.textContent || '').replace(/\s+/g, ' ').trim();
    return text;
  }).filter(Boolean));
  for (const button of buttons) {
    const key = normalize(button);
    if (!key) continue;
    const entry = buttonInventory.get(key) ?? { count: 0, screens: new Set() };
    entry.count += 1;
    entry.screens.add(label);
    buttonInventory.set(key, entry);
  }
}

async function waitApi(page, pathPart, method = 'GET', timeout = 15000) {
  return page.waitForResponse((response) => (
    response.url().startsWith(apiUrl)
    && response.url().includes(pathPart)
    && response.request().method() === method
  ), { timeout });
}

async function login(page) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByPlaceholder('E-mail').fill(adminEmail);
  await page.getByPlaceholder('Senha').fill(adminPassword);
  const responsePromise = waitApi(page, '/auth/login', 'POST');
  await clickButton(page.getByRole('button', { name: 'Entrar no painel' }), 'Entrar no painel');
  const response = await responsePromise;
  if (response.status() !== 200) throw new Error(`login retornou HTTP ${response.status()}`);
  await page.locator('.main-menu').waitFor({ state: 'visible', timeout: 12000 });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appUrl });
const page = await context.newPage();

page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('response', (response) => {
  if (response.url().startsWith(apiUrl) && response.status() >= 500) {
    apiServerErrors.push(`${response.request().method()} ${response.url()} -> ${response.status()}`);
  }
});

try {
  await step('Login pelo frontend', async () => login(page));
  await snapshotButtons(page, 'dashboard');

  const menu = page.locator('.menu-actions');
  for (const [buttonName, heading] of [
    ['Dashboard', 'Dashboard'],
    ['Ofertas', 'Ofertas'],
    ['Marketplaces', 'Marketplaces'],
    ['Automação', 'Regras e distribuição'],
    ['Configurações', 'Configurações']
  ]) {
    await step(`Menu ${buttonName}`, async () => {
      await clickButton(menu.getByRole('button', { name: buttonName, exact: true }), buttonName);
      await page.locator('.header-copy h1').filter({ hasText: heading }).waitFor({ state: 'visible', timeout: 8000 });
      await snapshotButtons(page, `menu-${buttonName}`);
    });
  }

  await step('Botao Abrir ofertas', async () => {
    await clickButton(menu.getByRole('button', { name: 'Dashboard', exact: true }), 'Dashboard');
    await clickButton(page.getByRole('button', { name: 'Abrir ofertas', exact: true }), 'Abrir ofertas');
    await page.locator('.header-copy h1').filter({ hasText: 'Ofertas' }).waitFor({ state: 'visible' });
  });

  await step('Filtro de ofertas', async () => {
    await page.getByPlaceholder('Buscar produto ou palavra-chave').fill('QA');
    await page.locator('.collector-actions select').selectOption('mercadolivre');
    const discount = page.locator('.collector-actions input[type="number"]');
    await discount.fill('50');
    const responsePromise = waitApi(page, '/api/v1/offers?', 'GET');
    await clickButton(page.getByRole('button', { name: 'Filtrar', exact: true }), 'Filtrar');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`filtro retornou HTTP ${response.status()}`);
    await page.locator('.offer-card').filter({ hasText: 'QA Oferta Mercado Livre' }).first().waitFor({ state: 'visible', timeout: 8000 });
  });

  await step('Busca imediata de ofertas', async () => {
    const button = page.getByRole('button', { name: 'Buscar agora', exact: true });
    markTested('Buscar agora');
    await button.click();
    await page.locator('.status-message').waitFor({ state: 'visible', timeout: 40000 });
  }, { warn: true });

  await step('Sincronizar dados', async () => {
    const responsePromise = waitApi(page, '/api/v1/offers?', 'GET');
    await clickButton(page.getByRole('button', { name: 'Sincronizar dados', exact: true }), 'Sincronizar dados');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`sincronizacao retornou HTTP ${response.status()}`);
    await page.getByText('Dados atualizados.', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
  });

  await snapshotButtons(page, 'ofertas-com-cards');
  const affiliateCard = page.locator('.offer-card').filter({ hasText: 'QA Oferta Mercado Livre afiliada' }).first();
  const pendingCard = page.locator('.offer-card').filter({ hasText: 'QA Oferta Mercado Livre pendente' }).first();

  await step('Copiar link de oferta', async () => {
    await clickButton(affiliateCard.getByRole('button', { name: 'Copiar link', exact: true }), 'Copiar link');
    await page.getByText('Link afiliado copiado.', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
  });

  await step('Enviar oferta para WhatsApp', async () => {
    const responsePromise = waitApi(page, '/dispatch/whatsapp/', 'POST');
    await clickButton(affiliateCard.getByRole('button', { name: 'Enviar WhatsApp', exact: true }), 'Enviar WhatsApp');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`envio WhatsApp retornou HTTP ${response.status()}`);
    await page.locator('.status-message').waitFor({ state: 'visible', timeout: 8000 });
  });

  await step('Afiliar produto pendente', async () => {
    const responsePromise = waitApi(page, '/affiliate', 'POST').catch(() => null);
    await clickButton(pendingCard.getByRole('button', { name: 'Afiliar produto', exact: true }), 'Afiliar produto');
    await responsePromise;
    await page.locator('.status-message').waitFor({ state: 'visible', timeout: 12000 });
  }, { warn: true });

  await step('Abrir tela Automação', async () => {
    await clickButton(menu.getByRole('button', { name: 'Automação', exact: true }), 'Automação');
    await page.locator('.header-copy h1').filter({ hasText: 'Regras e distribuição' }).waitFor({ state: 'visible' });
  });

  await step('Criar fonte da busca atual', async () => {
    const responsePromise = waitApi(page, '/admin/sources', 'POST');
    await clickButton(page.getByRole('button', { name: 'Criar fonte da busca atual', exact: true }), 'Criar fonte da busca atual');
    const response = await responsePromise;
    if (![200, 201].includes(response.status())) throw new Error(`criar fonte HTTP ${response.status()}`);
  });

  await step('Alternar fonte', async () => {
    const row = page.locator('.compact-row').filter({ hasText: 'Fonte mercadolivre' }).first();
    const toggle = row.getByRole('button', { name: /Desativar|Ativar/ });
    const label = normalize(await toggle.innerText());
    const responsePromise = waitApi(page, '/admin/sources/', 'PUT');
    await clickButton(toggle, label);
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`alternar fonte HTTP ${response.status()}`);
  });

  await step('Criar alerta da busca atual', async () => {
    const responsePromise = waitApi(page, '/alerts', 'POST');
    await clickButton(page.getByRole('button', { name: 'Criar alerta da busca atual', exact: true }), 'Criar alerta da busca atual');
    const response = await responsePromise;
    if (![200, 201].includes(response.status())) throw new Error(`criar alerta HTTP ${response.status()}`);
  });

  await step('Alternar alerta', async () => {
    const row = page.locator('.compact-row').filter({ hasText: 'Alerta QA' }).first();
    const toggle = row.getByRole('button', { name: /Desativar|Ativar/ });
    const label = normalize(await toggle.innerText());
    const responsePromise = waitApi(page, '/alerts/', 'PUT');
    await clickButton(toggle, label);
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`alternar alerta HTTP ${response.status()}`);
  });

  const textarea = page.locator('textarea').first();
  const channelModels = [
    ['Modelo Webhook', 'webhook', 'Webhook'],
    ['Modelo Telegram', 'telegram', 'Telegram'],
    ['Modelo WhatsApp', 'whatsapp', 'WhatsApp'],
    ['Modelo Evolution', 'evolution', 'Evolution API']
  ];
  for (const [modelButton, type, createButton] of channelModels) {
    await step(modelButton, async () => {
      await clickButton(page.getByRole('button', { name: modelButton, exact: true }), modelButton);
      const value = await textarea.inputValue();
      if (!value.trim().startsWith('{')) throw new Error('modelo nao preencheu JSON');
    });
    await step(`Criar canal ${type}`, async () => {
      const responsePromise = waitApi(page, '/dispatch/channels', 'POST');
      await clickButton(page.getByRole('button', { name: createButton, exact: true }), createButton);
      const response = await responsePromise;
      if (![200, 201].includes(response.status())) throw new Error(`criar canal ${type} HTTP ${response.status()}`);
    });
  }

  await step('Alternar canal criado', async () => {
    const row = page.locator('.compact-row').filter({ hasText: 'Canal webhook' }).first();
    const toggle = row.getByRole('button', { name: /Desativar|Ativar/ });
    const label = normalize(await toggle.innerText());
    const responsePromise = waitApi(page, '/dispatch/channels/', 'PUT');
    await clickButton(toggle, label);
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`alternar canal HTTP ${response.status()}`);
  });

  await step('Criar usuario pelo painel', async () => {
    await page.getByPlaceholder('Nome').fill('QA Browser');
    await page.getByPlaceholder('E-mail').fill(`qa-browser-${runId}@test.local`);
    await page.getByPlaceholder('Senha mínima 12 caracteres').fill('QaBrowserPassword123!');
    const responsePromise = waitApi(page, '/admin/users', 'POST');
    await clickButton(page.getByRole('button', { name: 'Criar usuário', exact: true }), 'Criar usuário');
    const response = await responsePromise;
    if (![200, 201].includes(response.status())) throw new Error(`criar usuario HTTP ${response.status()}`);
  });

  await step('Alternar usuario criado', async () => {
    const row = page.locator('.compact-row').filter({ hasText: `qa-browser-${runId}@test.local` }).first();
    const toggle = row.getByRole('button', { name: /Desativar|Ativar/ });
    const label = normalize(await toggle.innerText());
    const responsePromise = waitApi(page, '/admin/users/', 'PUT');
    await clickButton(toggle, label);
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`alternar usuario HTTP ${response.status()}`);
  });

  await step('Atualizar historico de envios', async () => {
    const responsePromise = waitApi(page, '/dispatch/logs', 'GET');
    await clickButton(page.getByRole('button', { name: 'Atualizar histórico', exact: true }), 'Atualizar histórico');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`historico HTTP ${response.status()}`);
  });
  await snapshotButtons(page, 'automacao');

  await step('Salvar configuracoes', async () => {
    await clickButton(menu.getByRole('button', { name: 'Configurações', exact: true }), 'Configurações');
    const responsePromise = waitApi(page, '/admin/settings', 'PUT');
    await clickButton(page.getByRole('button', { name: 'Salvar e aplicar', exact: true }), 'Salvar e aplicar');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`salvar configuracoes HTTP ${response.status()}`);
    await page.getByText('Configurações aplicadas.', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
  });
  await snapshotButtons(page, 'configuracoes');

  await step('Abrir Central de Afiliados', async () => {
    const launcher = page.locator('.affiliate-hub-launcher');
    markTested(normalize(await launcher.innerText()));
    await launcher.click();
    await page.locator('.affiliate-hub-panel').waitFor({ state: 'visible', timeout: 8000 });
  });
  await snapshotButtons(page, 'afiliados');

  const affiliatePanel = page.locator('.affiliate-hub-panel');
  const mlCard = affiliatePanel.locator('.affiliate-hub-card').filter({ hasText: 'Mercado Livre' }).first();
  const shopeeCard = affiliatePanel.locator('.affiliate-hub-card').filter({ hasText: 'Shopee' }).first();
  const amazonCard = affiliatePanel.locator('.affiliate-hub-card').filter({ hasText: 'Amazon' }).first();

  await step('Salvar conta Mercado Livre', async () => {
    await mlCard.getByLabel('E-mail da conta').fill('qa-browser-ml@test.local');
    await mlCard.getByLabel('Identificação da afiliação').fill('QA Browser ML');
    await mlCard.getByLabel('Client ID / App ID').fill('qa-browser-client');
    await mlCard.getByLabel('Client Secret').fill('qa-browser-secret');
    const responsePromise = waitApi(page, '/affiliate/connections/mercadolivre', 'PUT');
    await clickButton(mlCard.getByRole('button', { name: 'Salvar', exact: true }), 'Salvar');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`salvar Mercado Livre HTTP ${response.status()}`);
  });

  await step('Conectar Mercado Livre via OAuth', async () => {
    markTested('Conectar Mercado Livre');
    const token = await page.evaluate(() => sessionStorage.getItem('promo_token'));
    if (!token) throw new Error('token de sessao ausente');
    const oauthPage = await context.newPage();
    try {
      await oauthPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
      await oauthPage.evaluate((value) => sessionStorage.setItem('promo_token', value), token);
      await oauthPage.reload({ waitUntil: 'domcontentloaded' });
      await oauthPage.locator('.affiliate-hub-launcher').click();
      const button = oauthPage.getByRole('button', { name: 'Conectar Mercado Livre', exact: true });
      await button.waitFor({ state: 'visible' });
      const navigation = oauthPage.waitForURL((url) => url.hostname === 'auth.mercadolivre.com.br', { timeout: 15000 });
      await button.click();
      await navigation;
    } finally {
      await oauthPage.close();
    }
  });

  await step('Salvar conta Shopee', async () => {
    const responsePromise = waitApi(page, '/affiliate/connections/shopee', 'PUT');
    await clickButton(shopeeCard.getByRole('button', { name: 'Salvar e ativar', exact: true }), 'Salvar e ativar');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`salvar Shopee HTTP ${response.status()}`);
  });

  await step('Salvar conta Amazon', async () => {
    const responsePromise = waitApi(page, '/affiliate/connections/amazon', 'PUT');
    await clickButton(amazonCard.getByRole('button', { name: 'Salvar e ativar', exact: true }), 'Salvar e ativar');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`salvar Amazon HTTP ${response.status()}`);
  });

  await step('Afiliar ofertas em lote', async () => {
    const responsePromise = waitApi(page, '/affiliate/batch/resolve', 'POST');
    await clickButton(affiliatePanel.getByRole('button', { name: 'Afiliar ofertas', exact: true }), 'Afiliar ofertas');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`afiliacao em lote HTTP ${response.status()}`);
  });

  await step('Vincular link afiliado manual', async () => {
    const manualSection = affiliatePanel.locator('.affiliate-hub-operations.manual');
    const select = manualSection.locator('select');
    await select.selectOption({ label: 'QA Oferta Mercado Livre pendente' });
    await manualSection.getByPlaceholder('Cole o link de afiliado gerado pelo Mercado Livre').fill('https://www.mercadolivre.com.br/qa-browser-link-afiliado');
    const responsePromise = waitApi(page, '/affiliate/offers/', 'POST');
    await clickButton(manualSection.getByRole('button', { name: 'Validar e vincular', exact: true }), 'Validar e vincular');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`vinculo manual HTTP ${response.status()}`);
  });

  await step('Fechar Central de Afiliados', async () => {
    await clickButton(affiliatePanel.getByRole('button', { name: 'Fechar', exact: true }), 'Fechar');
    await affiliatePanel.waitFor({ state: 'detached', timeout: 8000 });
  });

  await step('Abrir Automacao IA', async () => {
    const toggle = page.locator('.automation-toggle');
    const name = normalize(await toggle.innerText());
    markTested(name);
    await toggle.click();
    await page.locator('.automation-panel').waitFor({ state: 'visible', timeout: 10000 });
  });
  await snapshotButtons(page, 'automacao-ia');

  const automationPanel = page.locator('.automation-panel');
  await step('Adicionar grupo WhatsApp', async () => {
    await automationPanel.getByPlaceholder('Nome do grupo').fill(`QA Grupo ${runId}`);
    await automationPanel.getByPlaceholder('ID do grupo ou número').fill('120363000000000000@g.us');
    const responsePromise = waitApi(page, '/dispatch/channels', 'POST');
    await clickButton(automationPanel.getByRole('button', { name: 'Adicionar grupo', exact: true }), 'Adicionar grupo');
    const response = await responsePromise;
    if (![200, 201].includes(response.status())) throw new Error(`adicionar grupo HTTP ${response.status()}`);
  });

  await step('Atualizar ofertas na Automacao IA', async () => {
    const responsePromise = waitApi(page, '/api/v1/offers?', 'GET');
    await clickButton(automationPanel.getByRole('button', { name: 'Atualizar ofertas', exact: true }), 'Atualizar ofertas');
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`atualizar ofertas HTTP ${response.status()}`);
  });

  const automationAction = automationPanel.getByRole('button', { name: 'Afiliar + IA + enviar', exact: true }).first();
  if (await automationAction.count()) {
    await step('Afiliar + IA + enviar', async () => {
      const responsePromise = waitApi(page, '/automation/affiliate-whatsapp/', 'POST', 30000);
      await clickButton(automationAction, 'Afiliar + IA + enviar');
      const response = await responsePromise;
      if (response.status() !== 200) throw new Error(`automacao completa HTTP ${response.status()}`);
      await automationPanel.locator('.automation-message').waitFor({ state: 'visible', timeout: 12000 });
    }, { warn: true });
  } else {
    record('warn', 'Afiliar + IA + enviar', 'nenhuma oferta elegivel apareceu no painel');
  }

  await step('Fechar Automacao IA', async () => {
    await clickButton(automationPanel.getByRole('button', { name: 'Fechar automação', exact: true }), 'Fechar automação');
    await automationPanel.waitFor({ state: 'detached', timeout: 8000 });
  });

  await step('Logout', async () => {
    await clickButton(page.getByRole('button', { name: 'Sair', exact: true }), 'Sair');
    await page.getByRole('button', { name: 'Entrar no painel', exact: true }).waitFor({ state: 'visible', timeout: 8000 });
  });

  const ignoredInventory = /^(Buscando|Afiliando|Enviando|Aplicando|Salvando|Processando|Executando|Entrando)\.\.\.$/i;
  const inventoryRows = [...buttonInventory.entries()].map(([name, value]) => ({
    name,
    count: value.count,
    screens: [...value.screens],
    tested: testedButtons.has(name)
  }));
  const uncovered = inventoryRows.filter((item) => !item.tested && !ignoredInventory.test(item.name));
  if (uncovered.length) {
    for (const item of uncovered) record('fail', `Botao sem cobertura: ${item.name}`, `telas: ${item.screens.join(', ')}`);
  }

  if (apiServerErrors.length) {
    for (const error of [...new Set(apiServerErrors)]) record('fail', 'Resposta 5xx detectada', error);
  }
  if (browserErrors.length) {
    for (const error of [...new Set(browserErrors)]) record('fail', 'Erro JavaScript detectado', error.slice(0, 500));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    appUrl,
    apiUrl,
    summary: {
      pass: results.filter((item) => item.status === 'pass').length,
      warn: results.filter((item) => item.status === 'warn').length,
      fail: results.filter((item) => item.status === 'fail').length
    },
    buttonInventory: inventoryRows,
    apiServerErrors: [...new Set(apiServerErrors)],
    browserErrors: [...new Set(browserErrors)],
    results
  };

  await mkdir(path.join(root, 'qa-reports'), { recursive: true });
  await writeFile(path.join(root, 'qa-reports', 'ui-buttons.json'), JSON.stringify(report, null, 2));
  console.log(`UI QA: ${report.summary.pass} passou, ${report.summary.warn} aviso(s), ${report.summary.fail} falhou.`);
  if (report.summary.fail > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
