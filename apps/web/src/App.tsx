import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

type Offer = {
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

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function App() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [stats, setStats] = useState<Stats>({ totalOffers: 0, bestScore: 0, bestDiscount: 0, marketplaces: {} });
  const [keyword, setKeyword] = useState('iphone');
  const [loading, setLoading] = useState(false);

  async function loadData() {
    const [offersResponse, statsResponse] = await Promise.all([
      fetch(`${apiUrl}/offers`),
      fetch(`${apiUrl}/offers/stats`)
    ]);
    const offersData = await offersResponse.json();
    const statsData = await statsResponse.json();
    setOffers(offersData.offers ?? []);
    setStats(statsData);
  }

  async function collectNow() {
    setLoading(true);
    try {
      await fetch(`${apiUrl}/collect/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, marketplace: 'mercadolivre' })
      });
    } finally {
      setLoading(false);
    }
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

  return (
    <main className="app-shell">
      <section className="hero">
        <span className="badge">Radar ao vivo</span>
        <h1>Solução de Promoção</h1>
        <p>Painel para encontrar oportunidades em marketplaces confiáveis e aprovar ofertas por score.</p>
        <div className="collector-actions">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <button onClick={collectNow} disabled={loading}>{loading ? 'Enfileirando...' : 'Varrer agora'}</button>
        </div>
      </section>

      <section className="stats-grid">
        <article><strong>{stats.totalOffers}</strong><span>Ofertas aprovadas</span></article>
        <article><strong>{stats.bestScore}</strong><span>Melhor score</span></article>
        <article><strong>{stats.bestDiscount}%</strong><span>Maior desconto</span></article>
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
