import { createApp as createBaseApp } from './bootstrap.js';
import { registerDispatchOperationsRoutes } from './dispatchOperations.js';
import { registerObservabilityRoutes } from './observabilityRoutes.js';
import { registerOperationalAlertRoutes } from './operationalAlertRoutes.js';

export async function createApp() {
  const app = await createBaseApp();
  await registerDispatchOperationsRoutes(app);
  await registerOperationalAlertRoutes(app);
  await registerObservabilityRoutes(app);
  return app;
}
