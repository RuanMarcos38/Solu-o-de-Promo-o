process.env.NODE_ENV ||= 'test';
process.env.DATABASE_URL ||= 'postgresql://promo:promo@localhost:5432/promo_test?schema=public';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-characters';
process.env.JWT_EXPIRES_IN ||= '15m';
process.env.JWT_ISSUER ||= 'promotion-radar-api-test';
process.env.JWT_AUDIENCE ||= 'promotion-radar-web-test';
process.env.FRONTEND_ORIGINS ||= 'http://localhost:5173';
process.env.BOOTSTRAP_ADMIN_ENABLED ||= 'true';
process.env.ADMIN_NAME ||= 'Administrador de Teste';
process.env.ADMIN_EMAIL ||= 'admin@test.local';
process.env.ADMIN_PASSWORD ||= 'TestAdminPassword123!';
process.env.CHANNEL_CONFIG_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.ALLOW_INSECURE_OUTBOUND_HTTP ||= 'false';
process.env.COLLECT_INTERVAL_SECONDS ||= '3600';
process.env.MIN_DISCOUNT_PERCENT ||= '50';
process.env.MIN_OPPORTUNITY_SCORE ||= '55';

if (process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL.includes('promo_test')) {
  throw new Error('Os testes de integração só podem usar um banco com promo_test no nome');
}
