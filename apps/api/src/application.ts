import { createApp as createBaseApp, type CreateAppOptions } from './bootstrap.js';
import { registerDispatchOperationsRoutes } from './dispatchOperations.js';
import { registerObservabilityRoutes } from './observabilityRoutes.js';
import { registerOperationalAlertRoutes } from './operationalAlertRoutes.js';
import { registerPromotionAutomationRoutes } from './promotionAutomationRoutes.js';

export async function createApp(options: CreateAppOptions = {}) {
  const app = await createBaseApp(options);
  await registerDispatchOperationsRoutes(app);
  await registerOperationalAlertRoutes(app);
  await registerObservabilityRoutes(app);
  await registerPromotionAutomationRoutes(app);
  return app;
}
