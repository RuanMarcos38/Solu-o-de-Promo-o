import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

type Offer = {
  id: string;
  externalId: string;
  marketplace: string;
  title: string;
  currentPrice: number;
  discountPercent?: number;
  imageUrl?: string;
  productUrl: string;
  affiliateUrl?: string;
  affiliateEligible: boolean;
  affiliateProvider?: string;
  score: number;
};

type Stats = {
  totalOffers: number;
  bestScore: number;
  bestDiscount: number;
  marketplaces: Record<string, number>;
};

type Source = { id: string; name: string; marketplace: string; isActive: boolean; keywords: string[] };
type AlertRule = { id: string; name: string; isActive: boolean; keywords: string[]; minDiscountPercent: number };
type DispatchChannel = { id: string; name: string; type: string; isActive: boolean };
type User = { id: string; name: string; email: string; role: string; isActive?: boolean };
type DispatchLog = { id: string; channel: string; status: string; error?: string; createdAt: string; offer?: { title: string; marketplace: string; currentPrice: number } | null };
type MarketplaceStatus = { marketplace: string; enabled: boolean; configured: boolean; affiliateLinks: boolean; detail: string };
type SystemStatus = {
  status: string;
  database: string;
  redis: string;
  queue: Record<string, number>;
  totals: {
    offers: number;
    activeSources: number;
    activeAlerts: number;
    activeChannels: number;
    sentDispatches: number;
    failedDispatches: number;
  };
};
type PlatformSettings = {
  branding: { platformName: string; timezone: string; locale: 'pt-BR'; currency: 'BRL' };
  collection: { automaticEnabled: boolean; intervalSeconds: number; maxResultsPerSource: number };
  qualification: { minDiscountPercent: number; minOpportunityScore: number; requireVerifiedAffiliateLinks: true };
  dispatch: { automaticEnabled: boolean; maxOffersPerCycle: number };
  publicApi: { enabled: boolean; defaultPageSize: number; maxPageSize: number };
};
type PlatformSettingsRecord = {
  settings: PlatformSettings;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
  source: 'database' | 'environment-defaults';
};

type Language = 'pt-BR' | 'en-US' | 'es-ES';
type ViewKey = 'dashboard' | 'offers' | 'marketplaces' | 'operation' | 'settings';

const minimumDiscountPercent = 50;
const productionApiUrl = 'https://api-ofertas.r2rmarketingdigital.com.br';
const apiUrl = (import.meta.env.VITE_API_URL ?? productionApiUrl).replace(/\/$/, '');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const apiUnavailableMessage = 'A API está indisponível no momento. Verifique o serviço api no EasyPanel e tente novamente.';

const languages: Record<Language, { label: string; short: string; copy: Record<string, string> }> = {
  'pt-BR': {
    label: 'Português do Brasil',
    short: 'PT-BR',
    copy: {
      badge: 'Operação online',
      logout: 'Sair',
      hero: 'Central SaaS para buscar ofertas qualificadas, gerar links afiliados e distribuir oportunidades com controle operacional.',
      filter: 'Filtrar',
      searchNow: 'Buscar agora',
      searching: 'Buscando...',
      refresh: 'Sincronizar dados',
      result: 'Lista de ofertas',
      offersFound: 'Ofertas encontradas',
      emptyTitle: 'Nenhuma oferta na tela ainda',
      emptyText: 'Use "Buscar agora" para consultar o marketplace e carregar os resultados imediatamente.',
      affiliateLink: 'Ver oferta afiliada',
      affiliateProduct: 'Afiliar produto',
      copyAffiliate: 'Copiar link',
      sendWhatsapp: 'Enviar WhatsApp',
      productLink: 'Ver oferta',
      untracked: 'Link não rastreado',
      approved: 'Ofertas aprovadas',
      bestScore: 'Melhor score',
      bestDiscount: 'Maior desconto',
      ready: 'Pronto',
      pending: 'Configuração pendente',
      disabled: 'Desativado'
    }
  },
  'en-US': {
    label: 'English',
    short: 'EN',
    copy: {
      badge: 'Online operation',
      logout: 'Sign out',
      hero: 'SaaS workspace to find qualified offers, create affiliate links, and distribute opportunities with operational control.',
      filter: 'Filter',
      searchNow: 'Search now',
      searching: 'Searching...',
      refresh: 'Sync data',
      result: 'Offer list',
      offersFound: 'Offers found',
      emptyTitle: 'No offers on screen yet',
      emptyText: 'Use "Search and show now" to query the marketplace and load results immediately.',
      affiliateLink: 'View affiliate offer',
      affiliateProduct: 'Create affiliate link',
      copyAffiliate: 'Copy link',
      sendWhatsapp: 'Send WhatsApp',
      productLink: 'View offer',
      untracked: 'Untracked link',
      approved: 'Approved offers',
      bestScore: 'Best score',
      bestDiscount: 'Biggest discount',
      ready: 'Ready',
      pending: 'Configuration pending',
      disabled: 'Disabled'
    }
  },
  'es-ES': {
    label: 'Español',
    short: 'ES',
    copy: {
      badge: 'Operación online',
      logout: 'Salir',
      hero: 'Espacio SaaS para buscar ofertas calificadas, crear enlaces afiliados y distribuir oportunidades con control operativo.',
      filter: 'Filtrar',
      searchNow: 'Buscar ahora',
      searching: 'Buscando...',
      refresh: 'Sincronizar datos',
      result: 'Lista de ofertas',
      offersFound: 'Ofertas encontradas',
      emptyTitle: 'Todavía no hay ofertas en pantalla',
      emptyText: 'Usa "Buscar y mostrar ahora" para consultar el marketplace y cargar los resultados de inmediato.',
      affiliateLink: 'Ver oferta afiliada',
      affiliateProduct: 'Afiliar producto',
      copyAffiliate: 'Copiar enlace',
      sendWhatsapp: 'Enviar WhatsApp',
      productLink: 'Ver oferta',
      untracked: 'Enlace no rastreado',
      approved: 'Ofertas aprobadas',
      bestScore: 'Mejor score',
      bestDiscount: 'Mayor descuento',
      ready: 'Listo',
      pending: 'Configuración pendiente',
      disabled: 'Desactivado'
    }
  }
};

const channelExamples: Record<string, string> = {
  webhook: '{"url":"https://seu-webhook.com/ofertas"}',
  telegram: '{"botToken":"TOKEN_DO_BOT","chatId":"ID_DO_CANAL","audience":"public"}',
  whatsapp: '{"provider":"evolution","baseUrl":"https://evolution.seudominio.com","apiKey":"SUA_API_KEY","instanceName":"minha-instancia","number":"5547999999999","audience":"private"}',
  evolution: '{"baseUrl":"https://evolution.seudominio.com","apiKey":"SUA_API_KEY","instanceName":"minha-instancia","number":"5547999999999","audience":"private"}'
};

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('promo_token') ?? '');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [stats, setStats] = useState<Stats>({ totalOffers: 0, bestScore: 0, bestDiscount: 0, marketplaces: {} });
  const [keyword, setKeyword] = useState('iphone');
  const [marketplace, setMarketplace] = useState('mercadolivre');
  const [minDiscount, setMinDiscount] = useState(String(minimumDiscountPercent));
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<DispatchChannel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsRecord | null>(null);
  const [marketplaceStatuses, setMarketplaceStatuses] = useState<MarketplaceStatus[]>([]);
  const [channelConfig, setChannelConfig] = useState(channelExamples.webhook);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('VIEWER');
  const [statusMessage, setStatusMessage] = useState('');
  const [offerActionId, setOfferActionId] = useState('');
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('promo_language') as Language | null;
    return saved && saved in languages ? saved : 'pt-BR';
  });

  const isAdmin = currentUser?.role === 'ADMIN';
  const canEdit = currentUser?.role === 'ADMIN' || currentUser?.role === 'EDITOR';
  const statusIsError = /erro|inválid|indisponível|falha|failed|não foi possível/i.test(statusMessage);
  const t = languages[language].copy;
  const platformName = platformSettings?.settings.branding.platformName ?? 'Zenite Ofertas';
  const effectiveMinDiscount = Math.max(minimumDiscountPercent, Number(minDiscount) || minimumDiscountPercent);
  const displayedOffers = offers.filter((offer) => (offer.discountPercent ?? 0) >= effectiveMinDiscount);
  const marketplaceCount = Object.keys(stats.marketplaces ?? {}).length;
  const averageVisibleDiscount = displayedOffers.length
    ? Number((displayedOffers.reduce((total, offer) => total + (offer.discountPercent ?? 0), 0) / displayedOffers.length).toFixed(1))
    : 0;
  const navItems: Array<{ key: ViewKey; label: string; adminOnly?: boolean }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'offers', label: 'Ofertas 50%+' },
    { key: 'marketplaces', label: 'Marketplaces' },
    { key: 'operation', label: 'Operação' },
    { key: 'settings', label: 'Configurações', adminOnly: true }
  ];

  function logout() {
    sessionStorage.removeItem('promo_token');
    setToken('');
    setCurrentUser(null);
    setSources([]);
    setAlerts([]);
    setChannels([]);
    setUsers([]);
    setLogs([]);
    setSystem(null);
    setPlatformSettings(null);
  }

  async function apiFetch(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetch(`${apiUrl}${path}`, { ...options, headers });
    } catch {
      throw new Error(apiUnavailableMessage);
    }
    if (!response.ok) {
      if (response.status === 401) logout();
      if (response.status >= 500) throw new Error(apiUnavailableMessage);
      const data = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(data?.message || `Erro HTTP ${response.status}`);
    }
    return response;
  }

  async function loginNow() {
    setLoading(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (response.status >= 500) throw new Error(apiUnavailableMessage);
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(data?.message || 'E-mail ou senha inválidos.');
      }
      const data = await response.json() as { token: string; user: User };
      sessionStorage.setItem('promo_token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      setPassword('');
      setStatusMessage('Login realizado com sucesso.');
    } catch (error) {
      setStatusMessage(error instanceof TypeError ? apiUnavailableMessage : error instanceof Error ? error.message : 'Erro ao entrar.');
    } finally {
      setLoading(false);
    }
  }

  async function loadSessionUser() {
    if (!token) return;
    try {
      const response = await apiFetch('/auth/me');
      const data = await response.json() as { user: User };
      setCurrentUser(data.user);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Sessão inválida.');
    }
  }

  async function loadData() {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (marketplace) params.set('marketplace', marketplace);
    if (minDiscount) params.set('minDiscount', minDiscount);
    params.set('includeUntracked', 'true');
    try {
      const [offersResponse, statsResponse, marketplacesResponse] = await Promise.all([
        fetch(`${apiUrl}/api/v1/offers?${params.toString()}`),
        fetch(`${apiUrl}/api/v1/offers/stats`),
        fetch(`${apiUrl}/api/v1/marketplaces`)
      ]);
      if (!offersResponse.ok || !statsResponse.ok || !marketplacesResponse.ok) throw new Error(apiUnavailableMessage);
      const offersData = await offersResponse.json();
      const statsData = await statsResponse.json();
      const marketplacesData = await marketplacesResponse.json();
      const nextOffers = offersData.offers ?? [];
      setOffers(nextOffers);
      setStats(statsData);
      setMarketplaceStatuses(marketplacesData.marketplaces ?? []);
      return nextOffers as Offer[];
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : apiUnavailableMessage);
      return [];
    }
  }

  async function loadPublicMeta() {
    try {
      const [statsResponse, marketplacesResponse] = await Promise.all([
        fetch(`${apiUrl}/api/v1/offers/stats`),
        fetch(`${apiUrl}/api/v1/marketplaces`)
      ]);
      if (!statsResponse.ok || !marketplacesResponse.ok) throw new Error(apiUnavailableMessage);
      const statsData = await statsResponse.json();
      const marketplacesData = await marketplacesResponse.json();
      setStats(statsData);
      setMarketplaceStatuses(marketplacesData.marketplaces ?? []);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : apiUnavailableMessage);
    }
  }

  async function loadAdminData() {
    if (!token || !currentUser) return;

    const [sourcesResponse, alertsResponse] = await Promise.all([
      apiFetch('/admin/sources'),
      apiFetch('/alerts')
    ]);
    setSources((await sourcesResponse.json()).sources ?? []);
    setAlerts((await alertsResponse.json()).alerts ?? []);

    if (canEdit) {
      const logsResponse = await apiFetch('/dispatch/logs?limit=20');
      setLogs((await logsResponse.json()).logs ?? []);
    } else {
      setLogs([]);
    }

    if (isAdmin) {
      const [channelsResponse, usersResponse, systemResponse, settingsResponse] = await Promise.all([
        apiFetch('/dispatch/channels'),
        apiFetch('/admin/users'),
        apiFetch('/admin/system'),
        apiFetch('/admin/settings')
      ]);
      setChannels((await channelsResponse.json()).channels ?? []);
      setUsers((await usersResponse.json()).users ?? []);
      setSystem(await systemResponse.json());
      setPlatformSettings(await settingsResponse.json());
    } else {
      setChannels([]);
      setUsers([]);
      setSystem(null);
      setPlatformSettings(null);
    }
  }

  async function collectNow() {
    setCollecting(true);
    setStatusMessage('');
    try {
      const response = await fetch(`${apiUrl}/api/v1/collect/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, marketplace })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(data?.message || apiUnavailableMessage);
      }
      const result = await response.json() as { offers?: Offer[]; approved?: Offer[]; approvedCount?: number; foundCount?: number; errors?: Array<{ error: string }> };
      const immediateOffers = result.offers ?? result.approved ?? [];
      const qualifiedImmediateOffers = immediateOffers.filter((offer) => (offer.discountPercent ?? 0) >= effectiveMinDiscount);
      let visibleCount = qualifiedImmediateOffers.length || result.approvedCount || 0;

      if (qualifiedImmediateOffers.length > 0) {
        setOffers((current) => {
          const seen = new Set<string>();
          return [...qualifiedImmediateOffers, ...current].filter((offer) => {
            const key = `${offer.marketplace}-${offer.externalId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, 100);
        });
        await Promise.all([loadPublicMeta(), loadAdminData().catch(() => undefined)]);
      } else {
        const visibleOffers = await loadData();
        await loadAdminData().catch(() => undefined);
        visibleCount = visibleOffers.length || visibleCount;
      }

      const errorHint = result.errors?.length ? ` ${result.errors.map((item) => item.error).join(' ')}` : '';
      setStatusMessage(
        visibleCount > 0
          ? `${visibleCount} oferta(s) exibidas agora.${errorHint}`
          : `Nenhuma oferta encontrada para este filtro.${errorHint}`
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao buscar ofertas agora.');
    } finally {
      setCollecting(false);
    }
  }

  function mergeOffer(nextOffer: Offer) {
    setOffers((current) => current.map((offer) => {
      const sameSavedOffer = offer.id === nextOffer.id;
      const sameMarketplaceOffer = offer.marketplace === nextOffer.marketplace && offer.externalId === nextOffer.externalId;
      return sameSavedOffer || sameMarketplaceOffer ? { ...offer, ...nextOffer } : offer;
    }));
  }

  async function affiliateOffer(offer: Offer) {
    if (!canEdit) return;
    setOfferActionId(`affiliate-${offer.id}`);
    setStatusMessage('');
    try {
      const response = await apiFetch(`/offers/${offer.id}/affiliate`, { method: 'POST' });
      const data = await response.json() as { offer: Offer };
      mergeOffer(data.offer);
      setStatusMessage('Produto afiliado e link rastreável atualizado.');
      await Promise.all([loadPublicMeta(), loadAdminData().catch(() => undefined)]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Não foi possível afiliar este produto.');
    } finally {
      setOfferActionId('');
    }
  }

  async function copyAffiliateLink(offer: Offer) {
    const link = offer.affiliateUrl ?? offer.productUrl;
    await navigator.clipboard.writeText(link);
    setStatusMessage(offer.affiliateEligible ? 'Link afiliado copiado.' : 'Link comum copiado. Afiliar antes de automatizar envios.');
  }

  async function sendOfferToWhatsapp(offer: Offer) {
    if (!canEdit) return;
    setOfferActionId(`whatsapp-${offer.id}`);
    setStatusMessage('');
    try {
      const response = await apiFetch(`/dispatch/whatsapp/${offer.id}`, { method: 'POST' });
      const data = await response.json() as { sent: string[]; failed: Array<{ channel: string; error: string }> };
      const sentText = data.sent.length ? `Enviado para ${data.sent.join(', ')}.` : 'Nenhum envio confirmado.';
      const failText = data.failed.length ? ` Falhas: ${data.failed.map((item) => `${item.channel}: ${item.error}`).join('; ')}` : '';
      setStatusMessage(`${sentText}${failText}`);
      await loadAdminData().catch(() => undefined);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Não foi possível enviar para WhatsApp.');
    } finally {
      setOfferActionId('');
    }
  }

  async function createSource() {
    await apiFetch('/admin/sources', {
      method: 'POST',
      body: JSON.stringify({ name: `Fonte ${marketplace}`, marketplace, keywords: keyword.split(',').map((item) => item.trim()).filter(Boolean) })
    });
    setStatusMessage('Fonte criada.');
    await loadAdminData();
  }

  async function toggleSource(source: Source) {
    await apiFetch(`/admin/sources/${source.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !source.isActive }) });
    await loadAdminData();
  }

  async function createAlert() {
    await apiFetch('/alerts', {
      method: 'POST',
      body: JSON.stringify({ name: `Alerta ${keyword}`, keywords: keyword.split(',').map((item) => item.trim()).filter(Boolean), marketplaces: [marketplace], minDiscountPercent: effectiveMinDiscount })
    });
    setStatusMessage('Alerta criado. A distribuição agora respeita alertas ativos.');
    await loadAdminData();
  }

  async function toggleAlert(alert: AlertRule) {
    await apiFetch(`/alerts/${alert.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !alert.isActive }) });
    await loadAdminData();
  }

  async function createChannel(type: string) {
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(channelConfig) as Record<string, unknown>;
    } catch {
      setStatusMessage('Configuração JSON do canal é inválida.');
      return;
    }

    await apiFetch('/dispatch/channels', {
      method: 'POST',
      body: JSON.stringify({ name: `Canal ${type}`, type, config: parsedConfig })
    });
    setStatusMessage(`Canal ${type} criado com configuração protegida.`);
    await loadAdminData();
  }

  async function toggleChannel(channel: DispatchChannel) {
    await apiFetch(`/dispatch/channels/${channel.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !channel.isActive }) });
    await loadAdminData();
  }

  async function createUser() {
    await apiFetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ name: newUserName, email: newUserEmail, password: newUserPassword, role: newUserRole })
    });
    setNewUserEmail('');
    setNewUserName('');
    setNewUserPassword('');
    setStatusMessage('Usuário criado.');
    await loadAdminData();
  }

  async function toggleUser(user: User) {
    await apiFetch(`/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !user.isActive }) });
    await loadAdminData();
  }

  function updatePlatformSettings(updater: (settings: PlatformSettings) => PlatformSettings) {
    setPlatformSettings((current) => current ? { ...current, settings: updater(current.settings) } : current);
  }

  async function saveSettings() {
    if (!platformSettings) return;
    setLoading(true);
    setStatusMessage('');
    try {
      const response = await apiFetch('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          expectedVersion: platformSettings.version,
          settings: platformSettings.settings
        })
      });
      setPlatformSettings(await response.json());
      setStatusMessage('Configurações validadas e aplicadas. O agendamento do robô foi atualizado.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao salvar configurações.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined);
    const socket = io(apiUrl);
    socket.on('offers:init', (items: Offer[]) => setOffers(items));
    socket.on('offer:new', (offer: Offer) => {
      setOffers((current) => {
        const filtered = current.filter((item) => `${item.marketplace}-${item.externalId}` !== `${offer.marketplace}-${offer.externalId}`);
        return [offer, ...filtered].slice(0, 100);
      });
    });
    socket.on('stats:update', (nextStats: Stats) => setStats(nextStats));
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('promo_language', language);
  }, [language]);

  useEffect(() => {
    if (token && !currentUser) loadSessionUser().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (token && currentUser) loadAdminData().catch((error) => setStatusMessage(error instanceof Error ? error.message : 'Erro ao carregar painel.'));
  }, [token, currentUser?.role]);

  if (!token) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">ZO</span>
            <strong>{platformName}</strong>
          </div>
          <span className="badge">Acesso administrativo</span>
          <h1>{platformName}</h1>
          <p>Entre para administrar fontes, alertas, usuários, canais de distribuição e varreduras em tempo real.</p>
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void loginNow(); }}>
            <label htmlFor="login-email">E-mail</label>
            <input id="login-email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" type="email" inputMode="email" autoComplete="username" required />
            <label htmlFor="login-password">Senha</label>
            <input id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" type="password" autoComplete="current-password" required />
            <button type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar no painel'}</button>
          </form>
          {statusMessage ? <p className={`status-message${statusIsError ? ' status-error' : ''}`} role="status">{statusMessage}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell app-workspace">
      <nav className="main-menu" aria-label="Menu principal">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">ZO</span>
          <div>
            <strong>{platformName}</strong>
            <span>Ofertas qualificadas a partir de {minimumDiscountPercent}%</span>
          </div>
        </div>
        <div className="menu-actions">
          {navItems.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <button
              key={item.key}
              className={activeView === item.key ? 'menu-button active' : 'menu-button'}
              onClick={() => setActiveView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <section className="workspace-header">
        <div className="topbar">
          <span className="badge">{t.badge} {currentUser ? `• ${currentUser.role}` : ''}</span>
          <div className="topbar-actions">
            <label className="language-select" htmlFor="language">
              <span>Idioma</span>
              <select id="language" value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label="Idioma da interface">
                {Object.entries(languages).map(([code, item]) => <option key={code} value={code}>{item.short}</option>)}
              </select>
            </label>
            <button className="ghost-button" onClick={logout}>{t.logout}</button>
          </div>
        </div>
        <div className="header-copy">
          <span className="eyebrow">Central comercial</span>
          <h1>{platformName}</h1>
          <p>{t.hero}</p>
        </div>
        <div className="collector-actions">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="iphone, notebook, smart tv..." />
          <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
            <option value="mercadolivre">Mercado Livre</option>
            <option value="amazon">Amazon</option>
            <option value="shopee">Shopee</option>
          </select>
          <input type="number" min={minimumDiscountPercent} max="100" value={minDiscount} onChange={(event) => setMinDiscount(String(Math.max(minimumDiscountPercent, Number(event.target.value) || minimumDiscountPercent)))} placeholder="Desconto mínimo" />
          <button onClick={loadData}>{t.filter}</button>
          {canEdit ? <button className="primary-action" onClick={collectNow} disabled={collecting}>{collecting ? t.searching : t.searchNow}</button> : null}
          <button onClick={loadAdminData}>{t.refresh}</button>
        </div>
        {statusMessage ? <p className={`status-message${statusIsError ? ' status-error' : ''}`} role="status">{statusMessage}</p> : null}
      </section>

      <section className="dashboard-view" hidden={activeView !== 'dashboard'}>
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">Dashboard</span>
            <h2>KPIs da operação</h2>
            <p>Visão rápida das oportunidades qualificadas. A vitrine fica limpa: apenas ofertas com {effectiveMinDiscount}% ou mais de desconto entram no painel.</p>
          </div>
          <button className="primary-action" onClick={() => { setActiveView('offers'); void loadData(); }}>Ver ofertas</button>
        </div>
        <section className="kpi-grid" aria-label="Indicadores principais">
          <article>
            <span>Ofertas qualificadas</span>
            <strong>{stats.totalOffers}</strong>
            <small>Base aprovada com desconto mínimo de {effectiveMinDiscount}%</small>
          </article>
          <article>
            <span>Na tela agora</span>
            <strong>{displayedOffers.length}</strong>
            <small>Resultado filtrado da busca atual</small>
          </article>
          <article>
            <span>Maior desconto</span>
            <strong>{stats.bestDiscount}%</strong>
            <small>Melhor oportunidade salva</small>
          </article>
          <article>
            <span>Score máximo</span>
            <strong>{stats.bestScore}</strong>
            <small>Qualidade da oferta</small>
          </article>
          <article>
            <span>Desconto médio visível</span>
            <strong>{averageVisibleDiscount}%</strong>
            <small>Média da lista atual</small>
          </article>
          <article>
            <span>Marketplaces ativos</span>
            <strong>{marketplaceCount}</strong>
            <small>Com ofertas qualificadas</small>
          </article>
        </section>
        <section className="dashboard-columns">
          <article className="dashboard-panel">
            <h3>Status dos conectores</h3>
            <div className="compact-list">
              {marketplaceStatuses.map((status) => (
                <div className="compact-row" key={status.marketplace}>
                  <span>{status.marketplace}<small>{status.detail}</small></span>
                  <strong className={status.configured ? 'state-ok' : 'state-warn'}>{status.configured ? t.ready : t.pending}</strong>
                </div>
              ))}
            </div>
          </article>
          <article className="dashboard-panel">
            <h3>Top ofertas 50%+</h3>
            <div className="compact-list">
              {displayedOffers.slice(0, 6).map((offer) => (
                <div className="compact-row" key={`dash-${offer.marketplace}-${offer.externalId}`}>
                  <span>{offer.title}<small>{offer.marketplace} - {money.format(offer.currentPrice)}</small></span>
                  <strong>{offer.discountPercent ?? 0}%</strong>
                </div>
              ))}
              {!displayedOffers.length ? <p className="panel-hint">Nenhuma oferta qualificada carregada ainda.</p> : null}
            </div>
          </article>
        </section>
      </section>

      <section className="results-heading" hidden={activeView !== 'offers'}>
        <div>
          <span className="eyebrow">{t.result}</span>
          <h2>{t.offersFound}</h2>
        </div>
        <strong>{displayedOffers.length}</strong>
      </section>

      <section className="offer-grid" hidden={activeView !== 'offers'}>
        {displayedOffers.map((offer) => (
          <article className="offer-card" key={`${offer.marketplace}-${offer.externalId}`}>
            {offer.imageUrl ? <img src={offer.imageUrl} alt={offer.title} /> : null}
            <div>
              <span className="marketplace">{offer.marketplace} - Score {offer.score}</span>
              <h2>{offer.title}</h2>
              <strong>{money.format(offer.currentPrice)}</strong>
              {offer.discountPercent ? <p>{offer.discountPercent}% OFF</p> : null}
              <div className="affiliate-state">
                <span className={offer.affiliateEligible ? 'state-ok' : 'state-warn'}>
                  {offer.affiliateEligible ? 'Afiliado ativo' : t.untracked}
                </span>
                {offer.affiliateProvider ? <small>{offer.affiliateProvider}</small> : null}
              </div>
              <div className="offer-actions">
                <a href={offer.affiliateUrl ?? offer.productUrl} target="_blank" rel="noreferrer sponsored">{offer.affiliateEligible ? t.affiliateLink : t.productLink}</a>
                {canEdit ? <button type="button" onClick={() => affiliateOffer(offer)} disabled={offerActionId === `affiliate-${offer.id}`}>{offerActionId === `affiliate-${offer.id}` ? 'Afiliando...' : t.affiliateProduct}</button> : null}
                <button type="button" className="ghost-button" onClick={() => copyAffiliateLink(offer)}>{t.copyAffiliate}</button>
                {canEdit ? <button type="button" className="whatsapp-button" onClick={() => sendOfferToWhatsapp(offer)} disabled={!offer.affiliateEligible || offerActionId === `whatsapp-${offer.id}`}>{offerActionId === `whatsapp-${offer.id}` ? 'Enviando...' : t.sendWhatsapp}</button> : null}
              </div>
            </div>
          </article>
        ))}
        {!displayedOffers.length ? (
          <article className="empty-results">
            <h2>{t.emptyTitle}</h2>
            <p>{t.emptyText}</p>
          </article>
        ) : null}
      </section>

      <section className="admin-grid" hidden={activeView !== 'marketplaces'}>
        {marketplaceStatuses.map((status) => (
          <article key={status.marketplace}>
            <h3>{status.marketplace}</h3>
            <strong>{status.configured ? t.ready : status.enabled ? t.pending : t.disabled}</strong>
            <p className="panel-hint">{status.detail}</p>
          </article>
        ))}
      </section>

      {isAdmin && system ? (
        <section className="admin-grid" hidden={activeView !== 'operation'}>
          <article>
            <h3>Status da operação</h3>
            <div className="compact-list">
              <div className="compact-row"><span>API geral<small>{system.status}</small></span></div>
              <div className="compact-row"><span>Banco de dados<small>{system.database}</small></span></div>
              <div className="compact-row"><span>Redis / fila<small>{system.redis}</small></span></div>
            </div>
          </article>
          <article>
            <h3>Fila BullMQ</h3>
            <div className="compact-list">
              {Object.entries(system.queue).map(([key, value]) => <div className="compact-row" key={key}><span>{key}<small>{value} jobs</small></span></div>)}
            </div>
          </article>
          <article>
            <h3>Indicadores internos</h3>
            <div className="compact-list">
              <div className="compact-row"><span>Fontes ativas<small>{system.totals.activeSources}</small></span></div>
              <div className="compact-row"><span>Alertas ativos<small>{system.totals.activeAlerts}</small></span></div>
              <div className="compact-row"><span>Canais ativos<small>{system.totals.activeChannels}</small></span></div>
              <div className="compact-row"><span>Envios / falhas<small>{system.totals.sentDispatches} / {system.totals.failedDispatches}</small></span></div>
            </div>
          </article>
        </section>
      ) : null}

      {isAdmin && platformSettings ? (
        <section className="settings-panel" hidden={activeView !== 'settings'}>
          <div className="settings-heading">
            <div>
              <span className="badge">Configuração operacional v{platformSettings.version}</span>
              <h2>Parâmetros da plataforma</h2>
              <p>Altere regras de operação sem editar código. Credenciais continuam protegidas no ambiente e nos canais criptografados.</p>
            </div>
            <button onClick={saveSettings} disabled={loading}>{loading ? 'Aplicando...' : 'Salvar e aplicar'}</button>
          </div>
          <div className="settings-grid">
            <fieldset>
              <legend>Identidade</legend>
              <label>Nome da plataforma<input value={platformSettings.settings.branding.platformName} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, branding: { ...settings.branding, platformName: event.target.value } }))} /></label>
              <label>Fuso horário<input value={platformSettings.settings.branding.timezone} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, branding: { ...settings.branding, timezone: event.target.value } }))} /></label>
              <small>Localidade pt-BR • Moeda BRL</small>
            </fieldset>
            <fieldset>
              <legend>Robô de varredura</legend>
              <label className="check-row"><input type="checkbox" checked={platformSettings.settings.collection.automaticEnabled} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, collection: { ...settings.collection, automaticEnabled: event.target.checked } }))} />Varredura automática ativa</label>
              <label>Intervalo em segundos<input type="number" min="60" max="86400" value={platformSettings.settings.collection.intervalSeconds} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, collection: { ...settings.collection, intervalSeconds: Number(event.target.value) } }))} /></label>
              <label>Resultados por fonte<input type="number" min="1" max="100" value={platformSettings.settings.collection.maxResultsPerSource} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, collection: { ...settings.collection, maxResultsPerSource: Number(event.target.value) } }))} /></label>
            </fieldset>
            <fieldset>
              <legend>Qualificação</legend>
              <label>Desconto mínimo (%)<input type="number" min={minimumDiscountPercent} max="100" value={Math.max(minimumDiscountPercent, platformSettings.settings.qualification.minDiscountPercent)} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, qualification: { ...settings.qualification, minDiscountPercent: Math.max(minimumDiscountPercent, Number(event.target.value) || minimumDiscountPercent) } }))} /></label>
              <label>Score mínimo<input type="number" min="0" max="100" value={platformSettings.settings.qualification.minOpportunityScore} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, qualification: { ...settings.qualification, minOpportunityScore: Number(event.target.value) } }))} /></label>
              <label className="check-row locked"><input type="checkbox" checked disabled />Somente links afiliados verificados</label>
            </fieldset>
            <fieldset>
              <legend>Distribuição</legend>
              <label className="check-row"><input type="checkbox" checked={platformSettings.settings.dispatch.automaticEnabled} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, dispatch: { ...settings.dispatch, automaticEnabled: event.target.checked } }))} />Envio automático ativo</label>
              <label>Ofertas por ciclo<input type="number" min="1" max="500" value={platformSettings.settings.dispatch.maxOffersPerCycle} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, dispatch: { ...settings.dispatch, maxOffersPerCycle: Number(event.target.value) } }))} /></label>
            </fieldset>
            <fieldset>
              <legend>API aberta</legend>
              <label className="check-row"><input type="checkbox" checked={platformSettings.settings.publicApi.enabled} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, publicApi: { ...settings.publicApi, enabled: event.target.checked } }))} />API pública ativa</label>
              <label>Itens padrão<input type="number" min="1" max="100" value={platformSettings.settings.publicApi.defaultPageSize} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, publicApi: { ...settings.publicApi, defaultPageSize: Number(event.target.value) } }))} /></label>
              <label>Limite máximo<input type="number" min="1" max="200" value={platformSettings.settings.publicApi.maxPageSize} onChange={(event) => updatePlatformSettings((settings) => ({ ...settings, publicApi: { ...settings.publicApi, maxPageSize: Number(event.target.value) } }))} /></label>
            </fieldset>
          </div>
          <small className="settings-meta">Origem: {platformSettings.source === 'database' ? 'banco versionado' : 'padrões seguros do ambiente'}{platformSettings.updatedAt ? ` • Atualizado em ${new Date(platformSettings.updatedAt).toLocaleString('pt-BR')}` : ''}</small>
        </section>
      ) : null}

      <section className="admin-grid" hidden={activeView !== 'operation'}>
        <article>
          <h3>Fontes</h3>
          {canEdit ? <button onClick={createSource}>Criar fonte da busca atual</button> : <p className="panel-hint">Acesso somente para consulta.</p>}
          <div className="compact-list">{sources.slice(0, 8).map((source) => <div className="compact-row" key={source.id}><span>{source.name}<small>{source.marketplace} • {source.keywords.join(', ')}</small></span>{canEdit ? <button onClick={() => toggleSource(source)}>{source.isActive ? 'Desativar' : 'Ativar'}</button> : null}</div>)}</div>
        </article>
        <article>
          <h3>Alertas</h3>
          {canEdit ? <button onClick={createAlert}>Criar alerta da busca atual</button> : null}
          <p className="panel-hint">Com alertas ativos, só serão distribuídas ofertas que combinarem com as regras.</p>
          <div className="compact-list">{alerts.slice(0, 8).map((alert) => <div className="compact-row" key={alert.id}><span>{alert.name}<small>{alert.minDiscountPercent}% OFF • {alert.isActive ? 'Ativo' : 'Inativo'}</small></span>{canEdit ? <button onClick={() => toggleAlert(alert)}>{alert.isActive ? 'Desativar' : 'Ativar'}</button> : null}</div>)}</div>
        </article>
        {isAdmin ? (
          <article>
            <h3>Distribuição</h3>
            <p className="panel-hint">Cadastre um canal WhatsApp/Evolution ativo. As ofertas afiliadas podem ser enviadas por clique e o robô também dispara automaticamente quando a regra de alerta combina.</p>
            <div className="mini-actions"><button onClick={() => setChannelConfig(channelExamples.webhook)}>Modelo Webhook</button><button onClick={() => setChannelConfig(channelExamples.telegram)}>Modelo Telegram</button><button onClick={() => setChannelConfig(channelExamples.whatsapp)}>Modelo WhatsApp</button><button onClick={() => setChannelConfig(channelExamples.evolution)}>Modelo Evolution</button></div>
            <textarea value={channelConfig} onChange={(event) => setChannelConfig(event.target.value)} />
            <div className="mini-actions"><button onClick={() => createChannel('webhook')}>Webhook</button><button onClick={() => createChannel('telegram')}>Telegram</button><button onClick={() => createChannel('whatsapp')}>WhatsApp</button><button onClick={() => createChannel('evolution')}>Evolution API</button></div>
            <div className="compact-list">{channels.slice(0, 8).map((channel) => <div className="compact-row" key={channel.id}><span>{channel.name}<small>{channel.type} • {channel.isActive ? 'Ativo' : 'Inativo'}</small></span><button onClick={() => toggleChannel(channel)}>{channel.isActive ? 'Desativar' : 'Ativar'}</button></div>)}</div>
          </article>
        ) : null}
      </section>

      {(isAdmin || canEdit) ? (
        <section className="admin-grid" hidden={activeView !== 'operation'}>
          {isAdmin ? (
            <article>
              <h3>Usuários</h3>
              <input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="Nome" />
              <input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="E-mail" />
              <input value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} type="password" placeholder="Senha mínima 12 caracteres" />
              <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}><option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option><option value="ADMIN">Admin</option></select>
              <button onClick={createUser}>Criar usuário</button>
              <div className="compact-list">{users.slice(0, 8).map((user) => <div className="compact-row" key={user.id}><span>{user.name}<small>{user.email} • {user.role} • {user.isActive ? 'Ativo' : 'Inativo'}</small></span><button onClick={() => toggleUser(user)}>{user.isActive ? 'Desativar' : 'Ativar'}</button></div>)}</div>
            </article>
          ) : null}
          {canEdit ? (
            <article>
              <h3>Logs de envio</h3>
              <button onClick={loadAdminData}>Atualizar logs</button>
              <div className="compact-list">{logs.slice(0, 10).map((log) => <div className="compact-row" key={log.id}><span>{log.channel} • {log.status}<small>{log.offer?.title ?? 'Oferta indisponível'} {log.error ? `• ${log.error}` : ''}</small></span></div>)}</div>
            </article>
          ) : null}
        </section>
      ) : null}

    </main>
  );
}
