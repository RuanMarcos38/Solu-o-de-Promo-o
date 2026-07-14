import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertSafeOutboundUrl } from '../src/http.js';

describe('proteção SSRF', () => {
  test('bloqueia protocolos não HTTP', async () => {
    await assert.rejects(() => assertSafeOutboundUrl('file:///etc/passwd'), /Somente URLs HTTP ou HTTPS/);
    await assert.rejects(() => assertSafeOutboundUrl('ftp://example.com/file'), /Somente URLs HTTP ou HTTPS/);
  });

  test('bloqueia credenciais embutidas na URL', async () => {
    await assert.rejects(
      () => assertSafeOutboundUrl('https://user:password@example.com/hook'),
      /Credenciais embutidas/
    );
  });

  test('bloqueia localhost e domínios locais', async () => {
    await assert.rejects(() => assertSafeOutboundUrl('https://localhost/hook'), /Host externo não permitido/);
    await assert.rejects(() => assertSafeOutboundUrl('https://service.local/hook'), /Host externo não permitido/);
  });

  test('bloqueia IPv4 privado, loopback e metadata cloud', async () => {
    const blocked = [
      'https://127.0.0.1/hook',
      'https://10.0.0.10/hook',
      'https://172.16.0.10/hook',
      'https://192.168.1.10/hook',
      'https://169.254.169.254/latest/meta-data'
    ];

    for (const url of blocked) {
      await assert.rejects(() => assertSafeOutboundUrl(url), /privado ou reservado/);
    }
  });

  test('rejeita URL inválida', async () => {
    await assert.rejects(() => assertSafeOutboundUrl('não é uma url'), /URL externa inválida/);
  });
});
