import { createApp as createBaseApp, type CreateAppOptions } from './bootstrap.js';
import { registerAffiliateConnectionRoutes } from './affiliateConnectionRoutes.js';
import { hydrateAffiliateRuntimeConfig } from './affiliateConnectionStore.js';
import { registerDispatchOperationsRoutes } from './dispatchOperations.js';
import { ensureMercadoLivreAccessToken } from './mercadoLivreOAuth.js';
import { registerObservabilityRoutes } from './observabilityRoutes.js';
import { registerOperationalAlertRoutes } from './operationalAlertRoutes.js';
import { registerPromotionAutomationRoutes } from './promotionAutomationRoutes.js';

export async function createApp(options: CreateAppOptions = {}) {
  const app = await createBaseApp(options);
  await hydrateAffiliateRuntimeConfig();
  await ensureMercadoLivreAccessToken();

  const mercadoLivreRefreshTimer = setInterval(() => {
    void ensureMercadoLivreAccessToken();
  }, 30 * 60 * 1000);
  mercadoLivreRefreshTimer.unref();

  await registerAffiliateConnectionRoutes(app);
  await registerDispatchOperationsRoutes(app);
  await registerOperationalAlertRoutes(app);
  await registerObservabilityRoutes(app);
  await registerPromotionAutomationRoutes(app);
  return app;
}
