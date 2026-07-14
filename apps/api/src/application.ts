import { createApp as createBaseApp } from './bootstrap.js';
import { registerDispatchOperationsRoutes } from './dispatchOperations.js';
import { registerOperationalAlertRoutes } from './operationalAlertRoutes.js';

export async function createApp() {
  const app = await createBaseApp();
  await registerDispatchOperationsRoutes(app);
  await registerOperationalAlertRoutes(app);
  return app;
}