import { useEffect, useState } from 'react';

type Offer = {
  id: string;
  marketplace: string;
  title: string;
  currentPrice: number;
  discountPercent?: number;
  affiliateEligible: boolean;
};

type AutomationResult = {
  offer: { title: string; affiliateProvider?: string };
  ai: { used: boolean; fallbackReason?: string };
  sent: string[];
  blocked: Array<{ channel: string; reason: string }>;
  failed: Array<{ channel: string; error: string }>;
};

type SafeChannel = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  configSummary?: { audience?: string; number?: string; to?: string };
};

const productionApiUrl = 'https://api-ofertas.r2rmarketingdigital.com.br';
const apiUrl = (import.meta.env.VITE_API_URL ?? productionApiUrl).replace(/\/$/, '');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function AutomationDock() {
  const [open, setOpen] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [channels, setChannels] = useState<SafeChannel[]>([]);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupNumber, setGroupNumber] = useState('');
  const [groupAudience, setGroupAudience] = useState<'public' | 'private'>('public');
  const [savingGroup, setSavingGroup] = useState(false);

  async function authenticatedFetch(path: string, options: RequestInit = {}) {
    const token = sessionStorage.getItem('promo_token');
    if (!token) throw new Error('Entre no painel para usar a automação.');
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers as Record<string, string> | undefined)
      }
    });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) throw new Error(data?.message || `Erro HTTP ${response.status}`);
    return { response, data };
  }

  async function loadChannels(currentRole: string) {
    if (currentRole !== 'ADMIN') {
      setChannels([]);
      return;
    }
    const result = await authenticatedFetch('/dispatch/channels');
    const data = result.data as unknown as { channels?: SafeChannel[] };
    setChannels((data.channels ?? []).filter((channel) => ['whatsapp', 'evolution'].includes(channel.type)));
  }

  async function loadOffers() {
    setLoading(true);
    setMessage('');
    try {
      const auth = await authenticatedFetch('/auth/me');
      const user = (auth.data as { user?: { role?: string } })?.user;
      const currentRole = String(user?.role ?? '');
      setRole(currentRole);
      if (!['ADMIN', 'EDITOR'].includes(currentRole)) {
        throw new Error('Seu perfil não possui permissão para disparar automações.');
      }

      const [response] = await Promise.all([
        fetch(`${apiUrl}/api/v1/offers?includeUntracked=true&minDiscount=50&limit=12`),
        loadChannels(currentRole)
      ]);
      if (!response.ok) throw new Error('Não foi possível carregar as ofertas.');
      const data = await response.json() as { offers?: Offer[] };
      setOffers(data.offers ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar automação.');
    } finally {
      setLoading(false);
    }
  }

  async function openDock() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) await loadOffers();
  }

  async function addGroup() {
    if (!groupName.trim() || !groupNumber.trim()) {
      setMessage('Informe o nome e o ID/número do grupo WhatsApp.');
      return;
    }
    setSavingGroup(true);
    setMessage('');
    try {
      await authenticatedFetch('/dispatch/channels', {
        method: 'POST',
        body: JSON.stringify({
          name: groupName.trim(),
          type: 'evolution',
          isActive: true,
          config: {
            number: groupNumber.trim(),
            audience: groupAudience
          }
        })
      });
      setGroupName('');
      setGroupNumber('');
      setMessage('Grupo WhatsApp cadastrado e ativado para automações.');
      await loadChannels('ADMIN');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao cadastrar grupo WhatsApp.');
    } finally {
      setSavingGroup(false);
    }
  }

  async function runAutomation(offer: Offer) {
    setActionId(offer.id);
    setMessage('');
    try {
      const { data } = await authenticatedFetch(`/automation/affiliate-whatsapp/${encodeURIComponent(offer.id)}`, {
        method: 'POST'
      });
      const result = data as unknown as AutomationResult;
      const sent = result.sent.length ? `${result.sent.length} grupo(s)/canal(is) enviado(s)` : 'nenhum envio confirmado';
      const ai = result.ai.used ? 'copy gerada por IA' : 'copy segura padrão';
      const blocked = result.blocked.length ? ` • ${result.blocked.length} bloqueado(s) por política` : '';
      const failed = result.failed.length ? ` • ${result.failed.length} falha(s)` : '';
      setMessage(`${result.offer.title}: ${sent}, ${ai}${blocked}${failed}.`);
      await loadOffers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha na automação.');
    } finally {
      setActionId('');
    }
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      if (!sessionStorage.getItem('promo_token')) setOpen(false);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [open]);

  return (
    <aside className={open ? 'automation-dock open' : 'automation-dock'} aria-label="Automação de afiliados e WhatsApp">
      <button className="automation-toggle" type="button" onClick={() => void openDock()} aria-expanded={open}>
        <span>IA</span>
        Automação
      </button>

      {open ? (
        <section className="automation-panel">
          <header>
            <div>
              <span className="eyebrow">Afiliado + WhatsApp</span>
              <h2>Automação IA</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => setOpen(false)} aria-label="Fechar automação">×</button>
          </header>
          <p>Afiliamos somente quando existe link oficial/verificado, geramos a copy e enviamos aos canais WhatsApp ativos permitidos.</p>

          {role === 'ADMIN' ? (
            <section className="automation-groups" aria-label="Grupos WhatsApp">
              <div className="automation-section-heading">
                <div>
                  <strong>Grupos WhatsApp</strong>
                  <small>{channels.filter((channel) => channel.isActive).length} ativo(s)</small>
                </div>
              </div>
              <div className="automation-group-form">
                <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Nome do grupo" maxLength={80} />
                <input value={groupNumber} onChange={(event) => setGroupNumber(event.target.value)} placeholder="ID do grupo ou número" maxLength={160} />
                <select value={groupAudience} onChange={(event) => setGroupAudience(event.target.value as 'public' | 'private')}>
                  <option value="public">Grupo público</option>
                  <option value="private">Grupo privado</option>
                </select>
                <button type="button" onClick={() => void addGroup()} disabled={savingGroup}>
                  {savingGroup ? 'Salvando...' : 'Adicionar grupo'}
                </button>
              </div>
              <small className="automation-policy-note">Para ofertas do Mercado Livre, somente canais públicos declarados são liberados.</small>
            </section>
          ) : null}

          <button className="ghost-button automation-refresh" type="button" onClick={() => void loadOffers()} disabled={loading}>
            {loading ? 'Atualizando...' : 'Atualizar ofertas'}
          </button>

          <div className="automation-list">
            {offers.map((offer) => (
              <article key={offer.id}>
                <div>
                  <small>{offer.marketplace} • {offer.discountPercent ?? 0}% OFF</small>
                  <strong>{offer.title}</strong>
                  <span>{money.format(offer.currentPrice)} • {offer.affiliateEligible ? 'Afiliado verificado' : 'Aguardando afiliação'}</span>
                </div>
                <button type="button" onClick={() => void runAutomation(offer)} disabled={Boolean(actionId)}>
                  {actionId === offer.id ? 'Executando...' : 'Afiliar + IA + enviar'}
                </button>
              </article>
            ))}
            {!loading && offers.length === 0 ? <p className="panel-hint">Nenhuma oferta qualificada disponível.</p> : null}
          </div>
          {message ? <p className="automation-message" role="status">{message}</p> : null}
        </section>
      ) : null}
    </aside>
  );
}
