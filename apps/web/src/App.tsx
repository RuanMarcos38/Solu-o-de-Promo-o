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

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

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
  const [channelConfig, setChannelConfig] = useState('{"url":"https://seu-webhook.com/ofertas"}');

  async function apiFetch(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${apiUrl}${path}`, { ...options, headers });
  }

  async function loginNow() {
    setLoading(true);
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
    const [sourcesResponse, alertsResponse, channelsResponse] = await Promise.all([
      apiFetch('/admin/sources'),
      apiFetch('/alerts'),
      apiFetch('/dispatch/channels')
    ]);
    if (sourcesResponse.ok) setSources((await sourcesResponse.json()).sources ?? []);
    if (alertsResponse.ok) setAlerts((await alertsResponse.json()).alerts ?? []);
    if (channelsResponse.ok) setChannels((await channelsResponse.json()).channels ?? []);
  }

  async function collectNow() {
    setLoading(true);
    try {
      await apiFetch('/collect/enqueue', {
        method: 'POST',
        body: JSON.stringify({ keyword, marketplace })
      });
    } finally {
      setLoading(false);
    }
  }

  async function createSource() {
    await apiFetch('/admin/sources', {
      method: 'POST',
      body: JSON.stringify({ name: `Fonte ${marketplace}`, marketplace, keywords: keyword.split(',').map((item) => item.trim()).filter(Boolean) })
    });
    await loadAdminData();
  }

  async function createAlert() {
    await apiFetch('/alerts', {
      method: 'POST',
      body: JSON.stringify({ name: `Alerta ${keyword}`, keywords: keyword.split(',').map((item) => item.trim()).filter(Boolean), marketplaces: [marketplace], minDiscountPercent: Number(minDiscount || 10) })
    });
    await loadAdminData();
  }

  async function createChannel(type: string) {
    let parsedConfig = {};
    try { parsedConfig = JSON.parse(channelConfig); } catch { parsedConfig = {}; }
    await apiFetch('/dispatch/channels', {
      method: 'POST',
      body: JSON.stringify({ name: `Canal ${type}`, type, config: parsedConfig })
    });
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

  useEffect(() => { loadAdminData(); }, [token]);

  if (!token) {
    return (
      <main className="app-shell auth-shell">
        <section className="hero auth-card">
          <span className="badge">Acesso administrativo</span>
          <h1>Solução de Promoção</h1>
          <p>Entre para administrar fontes, alertas, canais de distribuição e varreduras em tempo real.</p>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" type="password" />
          <button onClick={loginNow} disabled={loading}>{loading ? 'Entrando...' : 'Entrar no painel'}</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="topbar"><span className="badge">Radar ao vivo</span><button className="ghost-button" onClick={logout}>Sair</button></div>
        <h1>Solução de Promoção</h1>
        <p>Painel para encontrar oportunidades em marketplaces confiáveis, aprovar ofertas por score e distribuir automaticamente.</p>
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
        </div>
      </section>

      <section className="stats-grid">
        <article><strong>{stats.totalOffers}</strong><span>Ofertas aprovadas</span></article>
        <article><strong>{stats.bestScore}</strong><span>Melhor score</span></article>
        <article><strong>{stats.bestDiscount}%</strong><span>Maior desconto</span></article>
      </section>

      <section className="admin-grid">
        <article>
          <h3>Fontes</h3>
          <button onClick={createSource}>Criar fonte da busca atual</button>
          {sources.slice(0, 5).map((source) => <p key={source.id}>{source.name} • {source.marketplace} • {source.isActive ? 'Ativa' : 'Inativa'}</p>)}
        </article>
        <article>
          <h3>Alertas</h3>
          <button onClick={createAlert}>Criar alerta da busca atual</button>
          {alerts.slice(0, 5).map((alert) => <p key={alert.id}>{alert.name} • {alert.minDiscountPercent}% OFF</p>)}
        </article>
        <article>
          <h3>Distribuição</h3>
          <textarea value={channelConfig} onChange={(event) => setChannelConfig(event.target.value)} />
          <div className="mini-actions"><button onClick={() => createChannel('webhook')}>Webhook</button><button onClick={() => createChannel('telegram')}>Telegram</button><button onClick={() => createChannel('whatsapp')}>WhatsApp</button></div>
          {channels.slice(0, 5).map((channel) => <p key={channel.id}>{channel.name} • {channel.type} • {channel.isActive ? 'Ativo' : 'Inativo'}</p>)}
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
