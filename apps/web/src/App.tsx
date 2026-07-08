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
type User = { id: string; name: string; email: string; role: string; isActive: boolean };
type DispatchLog = { id: string; channel: string; status: string; error?: string; createdAt: string; offer?: { title: string; marketplace: string; currentPrice: number } | null };
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

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const channelExamples: Record<string, string> = {
  webhook: '{"url":"https://seu-webhook.com/ofertas"}',
  telegram: '{"botToken":"TOKEN_DO_BOT","chatId":"ID_DO_CANAL"}',
  whatsapp: '{"url":"https://sua-api-whatsapp.com/send","token":"TOKEN","to":"5547999999999"}',
  evolution: '{"baseUrl":"https://evolution.seudominio.com","apiKey":"SUA_API_KEY","instanceName":"minha-instancia","number":"5547999999999"}'
};

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem('promo_token') ?? '');
  const [email, setEmail] = useState('admin@promoradar.local');
  const [password, setPassword] = useState('admin123456');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [stats, setStats] = useState<Stats>({ totalOffers: 0, bestScore: 0, bestDiscount: 0, marketplaces: {} });
  const [keyword, setKeyword] = useState('iphone');
  const [marketplace, setMarketplace] = useState('mercadolivre');
  const [minDiscount, setMinDiscount] = useState('10');
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<DispatchChannel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [channelConfig, setChannelConfig] = useState(channelExamples.webhook);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('VIEWER');
  const [statusMessage, setStatusMessage] = useState('');

  async function apiFetch(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${apiUrl}${path}`, { ...options, headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Erro HTTP ${response.status}`);
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
      if (!response.ok) throw new Error('Login inválido');
      const data = await response.json();
      localStorage.setItem('promo_token', data.token);
      setToken(data.token);
      setStatusMessage('Login realizado com sucesso.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao entrar.');
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('promo_token');
    setToken('');
  }

  async function loadData() {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (marketplace) params.set('marketplace', marketplace);
    if (minDiscount) params.set('minDiscount', minDiscount);
    const [offersResponse, statsResponse] = await Promise.all([
      fetch(`${apiUrl}/offers?${params.toString()}`),
      fetch(`${apiUrl}/offers/stats`)
    ]);
    const offersData = await offersResponse.json();
    const statsData = await statsResponse.json();
    setOffers(offersData.offers ?? []);
    setStats(statsData);
  }

  async function loadAdminData() {
    if (!token) return;
    const [sourcesResponse, alertsResponse, channelsResponse, usersResponse, logsResponse, systemResponse] = await Promise.all([
      apiFetch('/admin/sources'),
      apiFetch('/alerts'),
      apiFetch('/dispatch/channels'),
      apiFetch('/admin/users'),
      apiFetch('/dispatch/logs?limit=20'),
      apiFetch('/admin/system')
    ]);
    setSources((await sourcesResponse.json()).sources ?? []);
    setAlerts((await alertsResponse.json()).alerts ?? []);
    setChannels((await channelsResponse.json()).channels ?? []);
    setUsers((await usersResponse.json()).users ?? []);
    setLogs((await logsResponse.json()).logs ?? []);
    setSystem(await systemResponse.json());
  }

  async function collectNow() {
    setLoading(true);
    setStatusMessage('');
    try {
      await apiFetch('/collect/enqueue', { method: 'POST', body: JSON.stringify({ keyword, marketplace }) });
      setStatusMessage('Coleta enviada para a fila.');
      await loadAdminData();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Erro ao enfileirar coleta.');
    } finally {
      setLoading(false);
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
      body: JSON.stringify({ name: `Alerta ${keyword}`, keywords: keyword.split(',').map((item) => item.trim()).filter(Boolean), marketplaces: [marketplace], minDiscountPercent: Number(minDiscount || 10) })
    });
    setStatusMessage('Alerta criado. A distribuição agora respeita alertas ativos.');
    await loadAdminData();
  }

  async function toggleAlert(alert: AlertRule) {
    await apiFetch(`/alerts/${alert.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !alert.isActive }) });
    await loadAdminData();
  }

  async function createChannel(type: string) {
    let parsedConfig = {};
    try { parsedConfig = JSON.parse(channelConfig); } catch { parsedConfig = {}; }
    await apiFetch('/dispatch/channels', {
      method: 'POST',
      body: JSON.stringify({ name: `Canal ${type}`, type, config: parsedConfig })
    });
    setStatusMessage(`Canal ${type} criado.`);
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

  useEffect(() => {
    loadData();
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

  useEffect(() => { loadAdminData().catch(() => undefined); }, [token]);

  if (!token) {
    return (
      <main className="app-shell auth-shell">
        <section className="hero auth-card">
          <span className="badge">Acesso administrativo</span>
          <h1>Solução de Promoção</h1>
          <p>Entre para administrar fontes, alertas, usuários, canais de distribuição e varreduras em tempo real.</p>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" type="password" />
          <button onClick={loginNow} disabled={loading}>{loading ? 'Entrando...' : 'Entrar no painel'}</button>
          {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="topbar"><span className="badge">Radar ao vivo</span><button className="ghost-button" onClick={logout}>Sair</button></div>
        <h1>Solução de Promoção</h1>
        <p>Painel para encontrar oportunidades em marketplaces confiáveis, aprovar ofertas por score e distribuir automaticamente conforme alertas ativos.</p>
        <div className="collector-actions">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="iphone, notebook, smart tv..." />
          <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
            <option value="mercadolivre">Mercado Livre</option>
            <option value="amazon">Amazon</option>
            <option value="shopee">Shopee</option>
          </select>
          <input value={minDiscount} onChange={(event) => setMinDiscount(event.target.value)} placeholder="Desconto mínimo" />
          <button onClick={loadData}>Filtrar</button>
          <button onClick={collectNow} disabled={loading}>{loading ? 'Enfileirando...' : 'Varrer agora'}</button>
          <button onClick={loadAdminData}>Atualizar operação</button>
        </div>
        {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
      </section>

      <section className="stats-grid">
        <article><strong>{stats.totalOffers}</strong><span>Ofertas aprovadas</span></article>
        <article><strong>{stats.bestScore}</strong><span>Melhor score</span></article>
        <article><strong>{stats.bestDiscount}%</strong><span>Maior desconto</span></article>
      </section>

      {system ? (
        <section className="admin-grid">
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

      <section className="admin-grid">
        <article>
          <h3>Fontes</h3>
          <button onClick={createSource}>Criar fonte da busca atual</button>
          <div className="compact-list">{sources.slice(0, 8).map((source) => <div className="compact-row" key={source.id}><span>{source.name}<small>{source.marketplace} • {source.keywords.join(', ')}</small></span><button onClick={() => toggleSource(source)}>{source.isActive ? 'Desativar' : 'Ativar'}</button></div>)}</div>
        </article>
        <article>
          <h3>Alertas</h3>
          <button onClick={createAlert}>Criar alerta da busca atual</button>
          <p className="panel-hint">Com alertas ativos, só serão distribuídas ofertas que combinarem com as regras.</p>
          <div className="compact-list">{alerts.slice(0, 8).map((alert) => <div className="compact-row" key={alert.id}><span>{alert.name}<small>{alert.minDiscountPercent}% OFF • {alert.isActive ? 'Ativo' : 'Inativo'}</small></span><button onClick={() => toggleAlert(alert)}>{alert.isActive ? 'Desativar' : 'Ativar'}</button></div>)}</div>
        </article>
        <article>
          <h3>Distribuição</h3>
          <div className="mini-actions"><button onClick={() => setChannelConfig(channelExamples.webhook)}>Modelo Webhook</button><button onClick={() => setChannelConfig(channelExamples.telegram)}>Modelo Telegram</button><button onClick={() => setChannelConfig(channelExamples.evolution)}>Modelo Evolution</button></div>
          <textarea value={channelConfig} onChange={(event) => setChannelConfig(event.target.value)} />
          <div className="mini-actions"><button onClick={() => createChannel('webhook')}>Webhook</button><button onClick={() => createChannel('telegram')}>Telegram</button><button onClick={() => createChannel('whatsapp')}>WhatsApp</button><button onClick={() => createChannel('evolution')}>Evolution API</button></div>
          <div className="compact-list">{channels.slice(0, 8).map((channel) => <div className="compact-row" key={channel.id}><span>{channel.name}<small>{channel.type} • {channel.isActive ? 'Ativo' : 'Inativo'}</small></span><button onClick={() => toggleChannel(channel)}>{channel.isActive ? 'Desativar' : 'Ativar'}</button></div>)}</div>
        </article>
      </section>

      <section className="admin-grid">
        <article>
          <h3>Usuários</h3>
          <input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="Nome" />
          <input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="E-mail" />
          <input value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} type="password" placeholder="Senha mínima 8 caracteres" />
          <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}><option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option><option value="ADMIN">Admin</option></select>
          <button onClick={createUser}>Criar usuário</button>
          <div className="compact-list">{users.slice(0, 8).map((user) => <div className="compact-row" key={user.id}><span>{user.name}<small>{user.email} • {user.role} • {user.isActive ? 'Ativo' : 'Inativo'}</small></span><button onClick={() => toggleUser(user)}>{user.isActive ? 'Desativar' : 'Ativar'}</button></div>)}</div>
        </article>
        <article>
          <h3>Logs de envio</h3>
          <button onClick={loadAdminData}>Atualizar logs</button>
          <div className="compact-list">{logs.slice(0, 10).map((log) => <div className="compact-row" key={log.id}><span>{log.channel} • {log.status}<small>{log.offer?.title ?? 'Oferta indisponível'} {log.error ? `• ${log.error}` : ''}</small></span></div>)}</div>
        </article>
      </section>

      <section className="offer-grid">
        {offers.map((offer) => (
          <article className="offer-card" key={`${offer.marketplace}-${offer.externalId}`}>
            {offer.imageUrl ? <img src={offer.imageUrl} alt={offer.title} /> : null}
            <div>
              <span className="marketplace">{offer.marketplace} • Score {offer.score}</span>
              <h2>{offer.title}</h2>
              <strong>{money.format(offer.currentPrice)}</strong>
              {offer.discountPercent ? <p>{offer.discountPercent}% OFF</p> : null}
              <a href={offer.productUrl} target="_blank" rel="noreferrer">Ver oferta</a>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
