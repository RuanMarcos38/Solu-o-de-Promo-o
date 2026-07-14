import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboardsDir = path.join(root, 'ops', 'grafana', 'dashboards');
const files = (await readdir(dashboardsDir)).filter((name) => name.endsWith('.json')).sort();
if (files.length < 2) throw new Error('São necessários pelo menos dois dashboards Grafana');

const dashboardUids = new Set();
for (const filename of files) {
  const dashboard = JSON.parse(await readFile(path.join(dashboardsDir, filename), 'utf8'));
  if (!dashboard.uid || !dashboard.title) throw new Error(`${filename}: uid e title são obrigatórios`);
  if (dashboardUids.has(dashboard.uid)) throw new Error(`${filename}: uid duplicado ${dashboard.uid}`);
  dashboardUids.add(dashboard.uid);
  if (!Array.isArray(dashboard.panels) || dashboard.panels.length < 4) {
    throw new Error(`${filename}: o dashboard precisa ter pelo menos quatro painéis`);
  }
  const panelIds = new Set();
  for (const panel of dashboard.panels) {
    if (!Number.isInteger(panel.id)) throw new Error(`${filename}: painel sem id inteiro`);
    if (panelIds.has(panel.id)) throw new Error(`${filename}: painel duplicado ${panel.id}`);
    panelIds.add(panel.id);
    if (!panel.title || !panel.type) throw new Error(`${filename}: painel ${panel.id} incompleto`);
  }
}

const prometheus = await readFile(path.join(root, 'ops', 'prometheus', 'prometheus.example.yml'), 'utf8');
for (const marker of ['alertmanagers:', 'promotion-radar-api', 'promotion-radar-worker']) {
  if (!prometheus.includes(marker)) throw new Error(`Prometheus sem configuração obrigatória: ${marker}`);
}

const alertmanager = await readFile(path.join(root, 'ops', 'alertmanager', 'alertmanager.example.yml'), 'utf8');
for (const marker of ['primary-oncall', 'secondary-oncall', 'warning-operations', 'group_wait: 15m', 'inhibit_rules:']) {
  if (!alertmanager.includes(marker)) throw new Error(`Alertmanager sem configuração obrigatória: ${marker}`);
}

console.log(`Observabilidade validada: ${files.length} dashboards, Prometheus e árvore de escalonamento do Alertmanager.`);
