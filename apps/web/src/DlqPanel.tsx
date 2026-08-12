import { useCallback, useEffect, useMemo, useState } from 'react';

type QueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
};

type OperationalOffer = {
  id: string;
  title: string;
  marketplace: string;
  currentPrice: number;
  score: number;
};

type DeadLetterItem = {
  id: string;
  state: string;
  queuedAt: string;
  failedAt: string;
  failedReason: string;
  attemptsMade: number;
  originalJobId: string;
  idempotencyKey: string;
  replayOf?: string | null;
  matchedAlertNames: string[];
  offer: OperationalOffer | null;
  channel: { id: string; name: string; type: string; isActive: boolean } | null;
};

type RecentFailure = {
  id: string;
  channel: string;
  error?: string | null;
  createdAt: string;
  payload?: Record<string, unknown> | null;
  offer: OperationalOffer | null;
};

type OperationsSnapshot = {
  generatedAt: string;
  queues: {
    collect: QueueCounts;
    dispatch: QueueCounts;
    deadLetter: QueueCounts;
  };
  dispatchLogs: {
    pending: number;
    sent: number;
    failed: number;
    skipped: number;
  };
  recentFailures: RecentFailure[];
  deadLetters: {
    total: number;
    offset: number;
    limit: number;
    items: DeadLetterItem[];
  };
};

const productionApiUrl = 'https://api-ofertas.r2rmarketingdigital.com.br';
const apiUrl = (import.meta.env.VITE_API_URL ?? productionApiUrl).replace(/\/$/, '');
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

function queueLoad(counts: QueueCounts) {
  return counts.waiting + counts.active + counts.delayed + counts.failed;
}

function QueueCard({ title, counts, description }: { title: string; counts: QueueCounts; description: string }) {
  return (
    <article className="ops-card">
      <div className="ops-card-heading">
        <div>
          <span className="ops-eyebrow">{description}</span>
          <h3>{title}</h3>
        </div>
        <strong className={queueLoad(counts) > 0 ? 'ops-number attention' : 'ops-number'}>{queueLoad(counts)}</strong>
      </div>
      <div className="ops-metrics">
        <span><b>{counts.waiting}</b> aguardando</span>
        <span><b>{counts.active}</b> ativos</span>
        <span><b>{counts.delayed}</b> atrasados</span>
        <span><b>{counts.failed}</b> falhos</span>
        <span><b>{counts.completed}</b> concluídos</span>
      </div>
    </article>
  );
}

export function DlqPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem('promo_token') ?? '');
  const [isAdmin, setIsAdmin] = useState(false);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextToken = sessionStorage.getItem('promo_token') ?? '';
      setToken((current) => current === nextToken ? current : nextToken);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) {
      setIsAdmin(false);
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sessão administrativa indisponível');
        return response.json() as Promise<{ user: { role: string } }>;
      })
      .then((data) => {
        if (!cancelled) setIsAdmin(data.user.role === 'ADMIN');
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });

    return () => { cancelled = true; };
  }, [token]);

  const loadOperations = useCallback(async (silent = false) => {
    if (!token || !isAdmin) return;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/dispatch/operations?limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => null) as OperationsSnapshot | { message?: string } | null;
      if (!response.ok) throw new Error(data && 'message' in data ? data.message : `Erro HTTP ${response.status}`);
      setSnapshot(data as OperationsSnapshot);
      if (!silent) setMessage('Operação atualizada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar as filas.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isAdmin, token]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadOperations();
    const timer = window.setInterval(() => void loadOperations(true), 15_000);
    return () => window.clearInterval(timer);
  }, [isAdmin, loadOperations]);

  const retryJob = useCallback(async (jobId: string) => {
    if (!token) return;
    setRetryingId(jobId);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/admin/dispatch/dlq/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await response.json().catch(() => null) as { message?: string; dispatchJobId?: string } | null;
      if (!response.ok) throw new Error(data?.message || `Erro HTTP ${response.status}`);
      setMessage(`Job reprocessado: ${data?.dispatchJobId ?? jobId}`);
      await loadOperations(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao reprocessar o job.');
    } finally {
      setRetryingId('');
    }
  }, [loadOperations, token]);

  const filteredDeadLetters = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return snapshot?.deadLetters.items ?? [];
    return (snapshot?.deadLetters.items ?? []).filter((item) => [
      item.id,
      item.failedReason,
      item.offer?.title,
      item.offer?.marketplace,
      item.channel?.name,
      item.channel?.type
    ].some((value) => String(value ?? '').toLowerCase().includes(term)));
  }, [filter, snapshot]);

  if (!isAdmin) return null;

  return (
    <section className="operations-shell" aria-label="Operação das filas de distribuição">
      <div className="operations-panel">
        <div className="operations-header">
          <div>
            <span className="badge">Operação BullMQ • ADMIN</span>
            <h2>Painel de filas e Dead-Letter Queue</h2>
            <p>Acompanhe coletas, entregas, tentativas, falhas definitivas e reprocessamentos sem acessar diretamente o Redis.</p>
          </div>
          <button onClick={() => void loadOperations()} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar operação'}</button>
        </div>

        {message ? <p className="status-message">{message}</p> : null}

        {snapshot ? (
          <>
            <div className="operations-grid">
              <QueueCard title="Coleta de ofertas" description="collect-offers" counts={snapshot.queues.collect} />
              <QueueCard title="Distribuição" description="dispatch-offers" counts={snapshot.queues.dispatch} />
              <QueueCard title="Falhas definitivas" description="dispatch-dead-letter" counts={snapshot.queues.deadLetter} />
              <article className="ops-card">
                <div className="ops-card-heading">
                  <div><span className="ops-eyebrow">DispatchLog</span><h3>Resultados acumulados</h3></div>
                  <strong className="ops-number">{snapshot.dispatchLogs.failed}</strong>
                </div>
                <div className="ops-metrics">
                  <span><b>{snapshot.dispatchLogs.pending}</b> pendentes</span>
                  <span><b>{snapshot.dispatchLogs.sent}</b> enviados</span>
                  <span><b>{snapshot.dispatchLogs.failed}</b> falhos</span>
                  <span><b>{snapshot.dispatchLogs.skipped}</b> filtrados</span>
                </div>
              </article>
            </div>

            <div className="operations-columns">
              <article className="operations-section">
                <div className="operations-section-heading">
                  <div><h3>Falhas recentes</h3><p>Erros em retry ou já encaminhados à DLQ.</p></div>
                  <span className="ops-counter">{snapshot.recentFailures.length}</span>
                </div>
                <div className="operations-list">
                  {snapshot.recentFailures.length === 0 ? <p className="ops-empty">Nenhuma falha recente registrada.</p> : snapshot.recentFailures.map((failure) => {
                    const payload = failure.payload ?? {};
                    const attempt = typeof payload.attempt === 'number' ? payload.attempt : null;
                    return (
                      <div className="operations-row" key={failure.id}>
                        <div>
                          <strong>{failure.offer?.title ?? 'Oferta indisponível'}</strong>
                          <small>{failure.channel} • {dateTime.format(new Date(failure.createdAt))}{attempt ? ` • tentativa ${attempt}` : ''}</small>
                          <p>{failure.error || 'Falha sem mensagem detalhada.'}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="operations-section dlq-section">
                <div className="operations-section-heading">
                  <div><h3>Dead-Letter Queue</h3><p>{snapshot.deadLetters.total} entrega(s) aguardando decisão administrativa.</p></div>
                  <span className={snapshot.deadLetters.total > 0 ? 'ops-counter danger' : 'ops-counter'}>{snapshot.deadLetters.total}</span>
                </div>
                <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar por oferta, canal, marketplace ou erro" />
                <div className="operations-list">
                  {filteredDeadLetters.length === 0 ? <p className="ops-empty">Nenhum item encontrado na DLQ.</p> : filteredDeadLetters.map((item) => (
                    <div className="operations-row dlq-row" key={item.id}>
                      <div>
                        <div className="ops-inline-title">
                          <strong>{item.offer?.title ?? 'Oferta removida'}</strong>
                          <span className="ops-state">{item.state}</span>
                        </div>
                        <small>{item.channel?.name ?? 'Canal removido'} • {item.channel?.type ?? 'desconhecido'} • {item.attemptsMade} tentativa(s)</small>
                        <p>{item.failedReason}</p>
                        <small>Falha final: {dateTime.format(new Date(item.failedAt))} • Job: {item.originalJobId}</small>
                      </div>
                      <button onClick={() => void retryJob(item.id)} disabled={retryingId === item.id}>
                        {retryingId === item.id ? 'Reprocessando...' : 'Reprocessar'}
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            </div>
            <p className="operations-updated">Atualizado em {dateTime.format(new Date(snapshot.generatedAt))} • atualização automática a cada 15 segundos.</p>
          </>
        ) : <p className="ops-empty">Carregando informações operacionais...</p>}
      </div>
    </section>
  );
}
