import { useEffect, useMemo, useState } from 'react';

type MarketplaceKey = 'mercadolivre' | 'shopee' | 'amazon';

type ConnectionStatus = {
  marketplace: MarketplaceKey;
  label: string;
  configured: boolean;
  accountConnected: boolean;
  canGenerateAffiliateLinks: boolean;
  connectionMethod: string;
  passwordStored: false;
  accountEmail?: string;
  affiliateLabel?: string;
  portalUrl: string;
  note: string;
  configSummary?: Record<string, unknown>;
};

type PendingOffer = {
  id: string;
  title: string;
  marketplace: string;
  affiliateEligible?: boolean;
};

const productionApiUrl = 'https://api-ofertas.r2rmarketingdigital.com.br';
const apiUrl = (import.meta.env.VITE_API_URL ?? productionApiUrl).replace(/\/$/, '');
const mercadoLivreCallback = `${apiUrl}/affiliate/connections/mercadolivre/oauth/callback`;

const initialMercadoLivre = {
  accountEmail: '',
  affiliateLabel: '',
  clientId: '',
  clientSecret: '',
  redirectUri: mercadoLivreCallback,
  resolverUrl: '',
  resolverToken: ''
};

const initialShopee = {
  accountEmail: '',
  affiliateLabel: '',
  appId: '',
  secret: '',
  endpoint: 'https://open-api.affiliate.shopee.com.br/graphql'
};

const initialAmazon = {
  accountEmail: '',
  affiliateLabel: '',
  partnerTag: '',
  credentialId: '',
  credentialSecret: '',
  tokenUrl: '',
  apiBaseUrl: 'https://creatorsapi.amazon'
};

function summaryText(status: ConnectionStatus | undefined, key: string) {
  const value = status?.configSummary?.[key];
  return typeof value === 'string' ? value : '';
}

function onlyFilled(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
}

export function AffiliateHub() {
  const [token, setToken] = useState(() => sessionStorage.getItem('promo_token') ?? '');
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mercadoLivre, setMercadoLivre] = useState(initialMercadoLivre);
  const [shopee, setShopee] = useState(initialShopee);
  const [amazon, setAmazon] = useState(initialAmazon);
  const [batchMarketplace, setBatchMarketplace] = useState('');
  const [batchLimit, setBatchLimit] = useState('30');
  const [pendingMercadoLivreOffers, setPendingMercadoLivreOffers] = useState<PendingOffer[]>([]);
  const [manualOfferId, setManualOfferId] = useState('');
  const [manualAffiliateUrl, setManualAffiliateUrl] = useState('');

  const byMarketplace = useMemo(() => Object.fromEntries(
    connections.map((item) => [item.marketplace, item])
  ) as Partial<Record<MarketplaceKey, ConnectionStatus>>, [connections]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = sessionStorage.getItem('promo_token') ?? '';
      setToken((previous) => previous === current ? previous : current);
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const affiliateResult = params.get('affiliate');
    if (!affiliateResult) return;
    setOpen(true);
    if (affiliateResult === 'mercadolivre-connected') {
      setMessage('Mercado Livre conectado com sucesso. Agora a plataforma pode usar a sessão OAuth para o catálogo autenticado.');
    } else if (affiliateResult === 'mercadolivre-error') {
      setError(params.get('reason') || 'O Mercado Livre não concluiu a conexão.');
    }
  }, []);

  async function request(path: string, options: RequestInit = {}) {
    if (!token) throw new Error('Entre na plataforma para acessar a Central de Afiliados.');
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || `Erro HTTP ${response.status}`);
    return data;
  }

  async function loadConnections() {
    if (!token) return;
    try {
      const data = await request('/affiliate/connections');
      const next = (data.connections ?? []) as ConnectionStatus[];
      setConnections(next);

      const ml = next.find((item) => item.marketplace === 'mercadolivre');
      const sp = next.find((item) => item.marketplace === 'shopee');
      const amz = next.find((item) => item.marketplace === 'amazon');

      setMercadoLivre((current) => ({
        ...current,
        accountEmail: ml?.accountEmail ?? summaryText(ml, 'accountEmail') ?? current.accountEmail,
        affiliateLabel: ml?.affiliateLabel ?? summaryText(ml, 'affiliateLabel') ?? current.affiliateLabel,
        clientId: summaryText(ml, 'clientId') || current.clientId,
        redirectUri: summaryText(ml, 'redirectUri') || current.redirectUri,
        resolverUrl: summaryText(ml, 'resolverUrl') || current.resolverUrl
      }));
      setShopee((current) => ({
        ...current,
        accountEmail: sp?.accountEmail ?? summaryText(sp, 'accountEmail') ?? current.accountEmail,
        affiliateLabel: sp?.affiliateLabel ?? summaryText(sp, 'affiliateLabel') ?? current.affiliateLabel,
        appId: summaryText(sp, 'appId') || current.appId,
        endpoint: summaryText(sp, 'endpoint') || current.endpoint
      }));
      setAmazon((current) => ({
        ...current,
        accountEmail: amz?.accountEmail ?? summaryText(amz, 'accountEmail') ?? current.accountEmail,
        affiliateLabel: amz?.affiliateLabel ?? summaryText(amz, 'affiliateLabel') ?? current.affiliateLabel,
        partnerTag: summaryText(amz, 'partnerTag') || current.partnerTag,
        credentialId: summaryText(amz, 'credentialId') || current.credentialId,
        tokenUrl: summaryText(amz, 'tokenUrl') || current.tokenUrl,
        apiBaseUrl: summaryText(amz, 'apiBaseUrl') || current.apiBaseUrl
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as conexões.');
    }
  }

  async function loadPendingMercadoLivre() {
    try {
      const response = await fetch(`${apiUrl}/api/v1/offers?marketplace=mercadolivre&includeUntracked=true&limit=50`);
      if (!response.ok) return;
      const data = await response.json();
      const offers = ((data.offers ?? []) as PendingOffer[]).filter((offer) => !offer.affiliateEligible);
      setPendingMercadoLivreOffers(offers);
      if (!manualOfferId && offers[0]?.id) setManualOfferId(offers[0].id);
    } catch {
      // A lista manual é complementar e não bloqueia a central.
    }
  }

  useEffect(() => {
    if (!open || !token) return;
    setError('');
    void Promise.all([loadConnections(), loadPendingMercadoLivre()]);
  }, [open, token]);

  async function saveConnection(marketplace: MarketplaceKey, values: Record<string, string>, success: string) {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const data = await request(`/affiliate/connections/${marketplace}`, {
        method: 'PUT',
        body: JSON.stringify(onlyFilled(values))
      });
      setConnections(data.connections ?? []);
      setMessage(success);
      if (marketplace === 'mercadolivre') {
        setMercadoLivre((current) => ({ ...current, clientSecret: '', resolverToken: '' }));
      } else if (marketplace === 'shopee') {
        setShopee((current) => ({ ...current, secret: '' }));
      } else {
        setAmazon((current) => ({ ...current, credentialSecret: '' }));
      }
      await loadConnections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar conexão.');
    } finally {
      setLoading(false);
    }
  }

  async function connectMercadoLivre() {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      await request('/affiliate/connections/mercadolivre', {
        method: 'PUT',
        body: JSON.stringify(onlyFilled(mercadoLivre))
      });
      const data = await request('/affiliate/connections/mercadolivre/oauth/start', { method: 'POST' });
      if (!data.authUrl) throw new Error('O backend não retornou a URL oficial de autorização.');
      window.location.assign(data.authUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao iniciar conexão com Mercado Livre.');
      setLoading(false);
    }
  }

  async function affiliateBatch() {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const data = await request('/affiliate/batch/resolve', {
        method: 'POST',
        body: JSON.stringify({
          ...(batchMarketplace ? { marketplace: batchMarketplace } : {}),
          limit: Number(batchLimit) || 30
        })
      });
      setMessage(`${data.affiliatedCount ?? 0} oferta(s) afiliadas. ${data.pendingCount ?? 0} ficaram pendentes por falta de link oficial.`);
      await loadPendingMercadoLivre();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível afiliar as ofertas em lote.');
    } finally {
      setLoading(false);
    }
  }

  async function saveManualLink() {
    if (!manualOfferId || !manualAffiliateUrl.trim()) {
      setError('Escolha uma oferta do Mercado Livre e cole o link de afiliado gerado no portal oficial.');
      return;
    }
    setLoading(true);
    setMessage('');
    setError('');
    try {
      await request(`/affiliate/offers/${encodeURIComponent(manualOfferId)}/manual-link`, {
        method: 'POST',
        body: JSON.stringify({ affiliateUrl: manualAffiliateUrl.trim() })
      });
      setManualAffiliateUrl('');
      setMessage('Link de afiliado validado e vinculado à oferta. Ela já pode ser enviada ao grupo.');
      await loadPendingMercadoLivre();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o link afiliado.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) return null;

  return (
    <>
      <button className="affiliate-hub-launcher" type="button" onClick={() => setOpen(true)}>
        <span>AF</span>
        Central de Afiliados
      </button>

      {open ? (
        <div className="affiliate-hub-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="affiliate-hub-panel" role="dialog" aria-modal="true" aria-label="Central de Afiliados">
            <header className="affiliate-hub-header">
              <div>
                <span className="affiliate-hub-kicker">MONETIZAÇÃO DE OFERTAS</span>
                <h2>Central de Afiliados</h2>
                <p>Conecte suas contas, gere links rastreáveis e prepare ofertas para disparo no WhatsApp.</p>
              </div>
              <button className="affiliate-hub-close" type="button" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
            </header>

            <div className="affiliate-hub-security">
              <strong>Suas senhas dos marketplaces não ficam armazenadas aqui.</strong>
              <span>Mercado Livre usa autorização OAuth. Shopee e Amazon usam credenciais próprias do programa de afiliados.</span>
            </div>

            {message ? <div className="affiliate-hub-message success">{message}</div> : null}
            {error ? <div className="affiliate-hub-message error">{error}</div> : null}

            <div className="affiliate-hub-grid">
              <article className="affiliate-hub-card">
                <div className="affiliate-hub-card-head">
                  <div>
                    <span className="affiliate-hub-market">Mercado Livre</span>
                    <h3>Afiliados e Criadores</h3>
                  </div>
                  <span className={`affiliate-hub-status ${byMarketplace.mercadolivre?.accountConnected ? 'ok' : ''}`}>
                    {byMarketplace.mercadolivre?.accountConnected ? 'Conta conectada' : 'Conectar conta'}
                  </span>
                </div>
                <p className="affiliate-hub-note">{byMarketplace.mercadolivre?.note || 'Conecte sua aplicação Mercado Livre pelo fluxo oficial.'}</p>
                <div className="affiliate-hub-fields two">
                  <label>E-mail da conta<input value={mercadoLivre.accountEmail} onChange={(e) => setMercadoLivre({ ...mercadoLivre, accountEmail: e.target.value })} placeholder="seu@email.com" /></label>
                  <label>Identificação da afiliação<input value={mercadoLivre.affiliateLabel} onChange={(e) => setMercadoLivre({ ...mercadoLivre, affiliateLabel: e.target.value })} placeholder="Minha conta de afiliado" /></label>
                  <label>Client ID / App ID<input value={mercadoLivre.clientId} onChange={(e) => setMercadoLivre({ ...mercadoLivre, clientId: e.target.value })} placeholder="Client ID da aplicação" /></label>
                  <label>Client Secret<input type="password" value={mercadoLivre.clientSecret} onChange={(e) => setMercadoLivre({ ...mercadoLivre, clientSecret: e.target.value })} placeholder={byMarketplace.mercadolivre?.configSummary?.clientSecretConfigured ? 'Configurado — deixe vazio para manter' : 'Client Secret'} /></label>
                  <label className="wide">URL de retorno OAuth<input value={mercadoLivre.redirectUri} onChange={(e) => setMercadoLivre({ ...mercadoLivre, redirectUri: e.target.value })} /></label>
                </div>
                <details className="affiliate-hub-advanced">
                  <summary>Integração avançada para link afiliado automático</summary>
                  <div className="affiliate-hub-fields">
                    <label>Resolvedor autorizado<input value={mercadoLivre.resolverUrl} onChange={(e) => setMercadoLivre({ ...mercadoLivre, resolverUrl: e.target.value })} placeholder="https://..." /></label>
                    <label>Token do resolvedor<input type="password" value={mercadoLivre.resolverToken} onChange={(e) => setMercadoLivre({ ...mercadoLivre, resolverToken: e.target.value })} placeholder={byMarketplace.mercadolivre?.configSummary?.resolverTokenConfigured ? 'Configurado — deixe vazio para manter' : 'Token opcional'} /></label>
                  </div>
                </details>
                <div className="affiliate-hub-actions">
                  <button type="button" onClick={connectMercadoLivre} disabled={loading}>Conectar Mercado Livre</button>
                  <button className="secondary" type="button" onClick={() => saveConnection('mercadolivre', mercadoLivre, 'Configuração do Mercado Livre salva com segurança.')} disabled={loading}>Salvar</button>
                  <a href={byMarketplace.mercadolivre?.portalUrl || 'https://www.mercadolivre.com.br/l/visite-o-portal-de-afiliados'} target="_blank" rel="noreferrer">Abrir Central de Afiliados</a>
                </div>
              </article>

              <article className="affiliate-hub-card">
                <div className="affiliate-hub-card-head">
                  <div>
                    <span className="affiliate-hub-market">Shopee</span>
                    <h3>Affiliate Open API</h3>
                  </div>
                  <span className={`affiliate-hub-status ${byMarketplace.shopee?.canGenerateAffiliateLinks ? 'ok' : ''}`}>
                    {byMarketplace.shopee?.canGenerateAffiliateLinks ? 'Link automático ativo' : 'Configurar API'}
                  </span>
                </div>
                <p className="affiliate-hub-note">{byMarketplace.shopee?.note || 'Use o App ID e Secret liberados na sua conta de afiliado.'}</p>
                <div className="affiliate-hub-fields two">
                  <label>E-mail da conta<input value={shopee.accountEmail} onChange={(e) => setShopee({ ...shopee, accountEmail: e.target.value })} placeholder="seu@email.com" /></label>
                  <label>Identificação da afiliação<input value={shopee.affiliateLabel} onChange={(e) => setShopee({ ...shopee, affiliateLabel: e.target.value })} placeholder="Minha conta Shopee" /></label>
                  <label>App ID<input value={shopee.appId} onChange={(e) => setShopee({ ...shopee, appId: e.target.value })} placeholder="App ID" /></label>
                  <label>App Secret<input type="password" value={shopee.secret} onChange={(e) => setShopee({ ...shopee, secret: e.target.value })} placeholder={byMarketplace.shopee?.configSummary?.secretConfigured ? 'Configurado — deixe vazio para manter' : 'App Secret'} /></label>
                  <label className="wide">Endpoint oficial<input value={shopee.endpoint} onChange={(e) => setShopee({ ...shopee, endpoint: e.target.value })} /></label>
                </div>
                <div className="affiliate-hub-actions">
                  <button type="button" onClick={() => saveConnection('shopee', shopee, 'Shopee conectada. As novas afiliações usarão a Affiliate Open API.')} disabled={loading}>Salvar e ativar</button>
                  <a href={byMarketplace.shopee?.portalUrl || 'https://affiliate.shopee.com.br/'} target="_blank" rel="noreferrer">Abrir portal Shopee</a>
                </div>
              </article>

              <article className="affiliate-hub-card">
                <div className="affiliate-hub-card-head">
                  <div>
                    <span className="affiliate-hub-market">Amazon</span>
                    <h3>Programa de Associados</h3>
                  </div>
                  <span className={`affiliate-hub-status ${byMarketplace.amazon?.canGenerateAffiliateLinks ? 'ok' : ''}`}>
                    {byMarketplace.amazon?.canGenerateAffiliateLinks ? 'Partner Tag ativa' : 'Configurar conta'}
                  </span>
                </div>
                <p className="affiliate-hub-note">{byMarketplace.amazon?.note || 'A Partner Tag atribui as vendas à sua conta de associado.'}</p>
                <div className="affiliate-hub-fields two">
                  <label>E-mail da conta<input value={amazon.accountEmail} onChange={(e) => setAmazon({ ...amazon, accountEmail: e.target.value })} placeholder="seu@email.com" /></label>
                  <label>Identificação da afiliação<input value={amazon.affiliateLabel} onChange={(e) => setAmazon({ ...amazon, affiliateLabel: e.target.value })} placeholder="Minha conta Amazon" /></label>
                  <label>Partner Tag<input value={amazon.partnerTag} onChange={(e) => setAmazon({ ...amazon, partnerTag: e.target.value })} placeholder="exemplo-20" /></label>
                  <label>Credential ID<input value={amazon.credentialId} onChange={(e) => setAmazon({ ...amazon, credentialId: e.target.value })} placeholder="Opcional para catálogo oficial" /></label>
                  <label className="wide">Credential Secret<input type="password" value={amazon.credentialSecret} onChange={(e) => setAmazon({ ...amazon, credentialSecret: e.target.value })} placeholder={byMarketplace.amazon?.configSummary?.credentialSecretConfigured ? 'Configurado — deixe vazio para manter' : 'Opcional para catálogo oficial'} /></label>
                </div>
                <details className="affiliate-hub-advanced">
                  <summary>Endpoints avançados da Creators API</summary>
                  <div className="affiliate-hub-fields">
                    <label>Token URL<input value={amazon.tokenUrl} onChange={(e) => setAmazon({ ...amazon, tokenUrl: e.target.value })} placeholder="Somente se sua conta informar" /></label>
                    <label>API Base URL<input value={amazon.apiBaseUrl} onChange={(e) => setAmazon({ ...amazon, apiBaseUrl: e.target.value })} /></label>
                  </div>
                </details>
                <div className="affiliate-hub-actions">
                  <button type="button" onClick={() => saveConnection('amazon', amazon, 'Amazon configurada. A Partner Tag será aplicada aos links elegíveis.')} disabled={loading}>Salvar e ativar</button>
                  <a href={byMarketplace.amazon?.portalUrl || 'https://associados.amazon.com.br/'} target="_blank" rel="noreferrer">Abrir Associados Amazon</a>
                </div>
              </article>
            </div>

            <section className="affiliate-hub-operations">
              <div className="affiliate-hub-operation-copy">
                <span className="affiliate-hub-kicker">ROTINA DIÁRIA</span>
                <h3>Afiliar ofertas em lote</h3>
                <p>Gera links de comissão para as melhores ofertas pendentes usando as conexões oficiais já configuradas.</p>
              </div>
              <div className="affiliate-hub-inline-form">
                <select value={batchMarketplace} onChange={(e) => setBatchMarketplace(e.target.value)}>
                  <option value="">Todos os marketplaces</option>
                  <option value="shopee">Shopee</option>
                  <option value="amazon">Amazon</option>
                  <option value="mercadolivre">Mercado Livre</option>
                </select>
                <input type="number" min="1" max="50" value={batchLimit} onChange={(e) => setBatchLimit(e.target.value)} aria-label="Quantidade de ofertas" />
                <button type="button" onClick={affiliateBatch} disabled={loading}>{loading ? 'Processando...' : 'Afiliar ofertas'}</button>
              </div>
            </section>

            <section className="affiliate-hub-operations manual">
              <div className="affiliate-hub-operation-copy">
                <span className="affiliate-hub-kicker">MERCADO LIVRE</span>
                <h3>Vincular link gerado no portal</h3>
                <p>Quando a conta não possui um gerador automático autorizado, gere o link na Central de Afiliados do Mercado Livre, selecione o produto abaixo e cole o link aqui.</p>
              </div>
              <div className="affiliate-hub-manual-form">
                <select value={manualOfferId} onChange={(e) => setManualOfferId(e.target.value)}>
                  <option value="">Selecione uma oferta pendente</option>
                  {pendingMercadoLivreOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.title}</option>)}
                </select>
                <input value={manualAffiliateUrl} onChange={(e) => setManualAffiliateUrl(e.target.value)} placeholder="Cole o link de afiliado gerado pelo Mercado Livre" />
                <button type="button" onClick={saveManualLink} disabled={loading}>Validar e vincular</button>
              </div>
            </section>

            <footer className="affiliate-hub-footer">
              <span>Fluxo recomendado: buscar ofertas → gerar link afiliado → revisar → disparar no WhatsApp.</span>
              <span>Somente links rastreáveis devem entrar na automação.</span>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
