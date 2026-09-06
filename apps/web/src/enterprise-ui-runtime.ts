const apiUrl = (import.meta.env.VITE_API_URL ?? 'https://api-ofertas.r2rmarketingdigital.com.br').replace(/\/$/, '');

function findButtonByText(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === text);
}

function openAffiliateHub() {
  const launcher = document.querySelector<HTMLButtonElement>('.affiliate-hub-launcher');
  launcher?.click();
}

async function testConnection(marketplace: 'mercadolivre' | 'shopee', button: HTMLButtonElement) {
  const token = sessionStorage.getItem('promo_token');
  if (!token) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Testando...';

  try {
    const response = await fetch(`${apiUrl}/affiliate/connections/${marketplace}/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
    const data = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) throw new Error(data.message || `Erro HTTP ${response.status}`);

    const panel = button.closest('.affiliate-hub-panel');
    panel?.querySelector('.enterprise-connection-result')?.remove();
    const result = document.createElement('div');
    result.className = 'enterprise-connection-result success';
    result.textContent = data.message || 'Conexão validada com sucesso.';
    panel?.querySelector('.affiliate-hub-security')?.insertAdjacentElement('afterend', result);
  } catch (error) {
    const panel = button.closest('.affiliate-hub-panel');
    panel?.querySelector('.enterprise-connection-result')?.remove();
    const result = document.createElement('div');
    result.className = 'enterprise-connection-result error';
    result.textContent = error instanceof Error ? error.message : 'Não foi possível validar a conexão.';
    panel?.querySelector('.affiliate-hub-security')?.insertAdjacentElement('afterend', result);
  } finally {
    button.disabled = false;
    button.textContent = original || 'Testar conexão';
  }
}

function enhanceAffiliateHub() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.affiliate-hub-card'));
  for (const card of cards) {
    const marketplaceName = card.querySelector('.affiliate-hub-market')?.textContent?.trim().toLowerCase();
    const actions = card.querySelector<HTMLElement>('.affiliate-hub-actions');
    if (!actions) continue;

    if (marketplaceName === 'shopee') {
      const portalLink = Array.from(actions.querySelectorAll<HTMLAnchorElement>('a')).find((anchor) => anchor.href.includes('affiliate.shopee.com.br'));
      if (portalLink) {
        portalLink.href = 'https://affiliate.shopee.com.br/open_api';
        portalLink.textContent = 'Entrar na Shopee Afiliados';
      }
      if (!actions.querySelector('[data-test-connection="shopee"]')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary enterprise-test-button';
        button.dataset.testConnection = 'shopee';
        button.textContent = 'Testar conexão';
        button.addEventListener('click', () => void testConnection('shopee', button));
        actions.appendChild(button);
      }
    }

    if (marketplaceName === 'mercado livre') {
      const connectButton = findButtonByText(actions, 'Conectar Mercado Livre');
      if (connectButton) connectButton.textContent = 'Entrar com Mercado Livre';
      if (!actions.querySelector('[data-test-connection="mercadolivre"]')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary enterprise-test-button';
        button.dataset.testConnection = 'mercadolivre';
        button.textContent = 'Testar conexão';
        button.addEventListener('click', () => void testConnection('mercadolivre', button));
        actions.appendChild(button);
      }
    }
  }
}

function enhanceMarketplaceMenu() {
  const menu = document.querySelector<HTMLElement>('.menu-actions');
  if (!menu) return;

  const marketplaceButton = findButtonByText(menu, 'Marketplaces') || findButtonByText(menu, 'Afiliados');
  if (marketplaceButton) {
    marketplaceButton.textContent = 'Afiliados';
    marketplaceButton.title = 'Conectar contas de afiliado e acompanhar integrações';
  }

  const grids = Array.from(document.querySelectorAll<HTMLElement>('.admin-grid'));
  const marketplaceGrid = grids.find((grid) => {
    if (grid.hidden) return false;
    const text = grid.textContent?.toLowerCase() ?? '';
    return text.includes('mercadolivre') || text.includes('mercado livre') || text.includes('shopee');
  });

  if (marketplaceGrid && !marketplaceGrid.querySelector('.enterprise-affiliate-entry')) {
    const entry = document.createElement('article');
    entry.className = 'enterprise-affiliate-entry';
    entry.innerHTML = `
      <div>
        <span class="enterprise-label">CONTAS AFILIADAS</span>
        <h3>Conecte Mercado Livre e Shopee</h3>
        <p>Use a conta aprovada do programa de afiliados para buscar ofertas e gerar links rastreáveis antes do disparo nos grupos.</p>
      </div>
      <button type="button" class="primary-action enterprise-open-affiliates">Gerenciar contas afiliadas</button>
    `;
    entry.querySelector<HTMLButtonElement>('.enterprise-open-affiliates')?.addEventListener('click', openAffiliateHub);
    marketplaceGrid.prepend(entry);
  }
}

function enhanceAutomationLauncher() {
  const toggle = document.querySelector<HTMLButtonElement>('.automation-toggle');
  if (!toggle || toggle.dataset.enterpriseReady) return;
  toggle.dataset.enterpriseReady = 'true';
  toggle.title = 'Disparo rápido de ofertas afiliadas para os grupos configurados';
}

function applyEnhancements() {
  enhanceMarketplaceMenu();
  enhanceAffiliateHub();
  enhanceAutomationLauncher();
}

const observer = new MutationObserver(() => applyEnhancements());
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('load', applyEnhancements);
setTimeout(applyEnhancements, 0);
