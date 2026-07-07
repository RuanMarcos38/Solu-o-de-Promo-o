import { config } from './config.js';
import { createApp } from './bootstrap.js';

const app = await createApp();
await app.listen({ port: config.apiPort, host: '0.0.0.0' });
