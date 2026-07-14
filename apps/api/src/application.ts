import { createApp as createBaseApp } from './bootstrap.js';
import { registerDispatchOperationsRoutes } from './dispatchOperations.js';

export async function createApp() {
  const app = await createBaseApp();
  await registerDispatchOperationsRoutes(app);
  return app;
}
