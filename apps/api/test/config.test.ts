import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inspectDatabaseUrl, resolveChannelEncryptionKey } from '../src/config.js';
import { resolveRedisConfiguration } from '../src/queue.js';

describe('configuração de produção', () => {
  test('aceita somente URL PostgreSQL isolada no schema do projeto', () => {
    assert.match(inspectDatabaseUrl('https://project.supabase.co', true) ?? '', /PostgreSQL/);
    assert.match(
      inspectDatabaseUrl('postgresql://user:password@db.example.com:5432/postgres?schema=public', true) ?? '',
      /schema=zenite_ofertas/
    );
    assert.equal(
      inspectDatabaseUrl(
        'postgresql://prisma_zenite:password@db.example.com:5432/postgres?sslmode=require&schema=zenite_ofertas',
        true
      ),
      undefined
    );
  });

  test('normaliza base64, hexadecimal e frase secreta para uma chave AES de 32 bytes', () => {
    const base64 = Buffer.alloc(32, 3).toString('base64');
    const fromBase64 = resolveChannelEncryptionKey(base64, 'jwt'.repeat(20), true);
    const fromHex = resolveChannelEncryptionKey('ab'.repeat(32), 'jwt'.repeat(20), true);
    const fromPassphrase = resolveChannelEncryptionKey('uma-frase-secreta-com-mais-de-trinta-e-dois-caracteres', 'jwt'.repeat(20), true);

    assert.equal(Buffer.from(fromBase64.key, 'base64').length, 32);
    assert.equal(Buffer.from(fromHex.key, 'base64').length, 32);
    assert.equal(Buffer.from(fromPassphrase.key, 'base64').length, 32);
    assert.equal(fromBase64.source, 'base64');
    assert.equal(fromHex.source, 'hex');
    assert.equal(fromPassphrase.source, 'passphrase');
  });

  test('deriva uma chave estável do JWT quando o valor informado é inválido', () => {
    const jwtSecret = 'jwt-de-producao-com-mais-de-trinta-e-dois-caracteres';
    const first = resolveChannelEncryptionKey('(chave configurada)', jwtSecret, true);
    const second = resolveChannelEncryptionKey(undefined, jwtSecret, true);

    assert.equal(first.source, 'jwt-derived');
    assert.equal(first.key, second.key);
    assert.equal(Buffer.from(first.key, 'base64').length, 32);
  });

  test('mantém a API inicializável quando REDIS_URL contém placeholder inválido', () => {
    const invalid = resolveRedisConfiguration('<URL INTERNA COPIADA DO REDIS>');
    const valid = resolveRedisConfiguration('rediss://default:password@redis.internal:6380/1');

    assert.match(invalid.issue ?? '', /REDIS_URL inválida/);
    assert.equal(invalid.url, 'redis://127.0.0.1:6379/0');
    assert.equal(valid.issue, undefined);
    assert.equal(valid.url, 'rediss://default:password@redis.internal:6380/1');
  });
});
