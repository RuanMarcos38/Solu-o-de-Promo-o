function findButtonByText(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === text);
}

function openAffiliateHub(event?: Event) {
  event?.preventDefault();
  const launcher = document.querySelector<HTMLButtonElement>('.affiliate-hub-launcher');
  launcher?.click();
}

function enhanceAffiliateHub() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.affiliate-hub-card'));
  for (const card of cards) {
    const marketplaceName = card.querySelector('.affiliate-hub-market')?.textContent?.trim().toLowerCase();
    const actions = card.querySelector<HTMLElement>('.affiliate-hub-actions');
    if (!actions) continue;

    if (marketplaceName === 'shopee') {
      const portalLink = Array.from(actions.querySelectorAll<HTMLAnchorElement>('a')).find((anchor) => anchor.href.includes('affiliate.shopee.com.br'));
      if (portalLink && portalLink.dataset.enterpriseReady !== 'true') {
        portalLink.dataset.enterpriseReady = 'true';
        portalLink.href = 'https://affiliate.shopee.com.br/open_api';
        portalLink.textContent = 'Entrar na Shopee Afiliados';
      }
    }
  }
}

function enhanceMarketplaceMenu() {
  const menu = document.querySelector<HTMLElement>('.menu-actions');
  if (!menu) return;

  const marketplaceButton = findButtonByText(menu, 'Marketplaces');
  if (marketplaceButton && marketplaceButton.dataset.enterpriseReady !== 'true') {
    marketplaceButton.dataset.enterpriseReady = 'true';
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
      <a href="#affiliate-hub" class="primary-action enterprise-open-affiliates">Gerenciar contas afiliadas</a>
    `;
    entry.querySelector<HTMLAnchorElement>('.enterprise-open-affiliates')?.addEventListener('click', openAffiliateHub);
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

let scheduled = false;
function scheduleEnhancements() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    applyEnhancements();
  });
}

const observer = new MutationObserver(() => scheduleEnhancements());
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('load', scheduleEnhancements);
setTimeout(scheduleEnhancements, 0);
