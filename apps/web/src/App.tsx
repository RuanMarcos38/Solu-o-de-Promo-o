import { useEffect, useState } from 'react';

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

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function App() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [keyword, setKeyword] = useState('iphone');
  const [loading, setLoading] = useState(false);

  async function loadOffers() {
    const response = await fetch(`${apiUrl}/offers`);
    const data = await response.json();
    setOffers(data.offers ?? []);
  }

  async function collectNow() {
    setLoading(true);
    await fetch(`${apiUrl}/collect/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, marketplace: 'mercadolivre' })
    });
    await loadOffers();
    setLoading(false);
  }

  useEffect(() => {
    loadOffers();
    const timer = window.setInterval(loadOffers, 10000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <span className="badge">Radar de ofertas</span>
        <h1>Solução de Promoção</h1>
        <p>Painel para encontrar oportunidades em marketplaces confiáveis e aprovar ofertas por score.</p>
        <div className="collector-actions">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <button onClick={collectNow} disabled={loading}>{loading ? 'Buscando...' : 'Varrer agora'}</button>
        </div>
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
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
