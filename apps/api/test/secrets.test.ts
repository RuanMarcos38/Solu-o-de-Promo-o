import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  decryptSensitiveConfig,
  encryptSensitiveConfig,
  summarizeSensitiveConfig
} from '../src/secrets.js';

describe('configurações sensíveis', () => {
  test('criptografa e descriptografa usando AES-256-GCM', () => {
    const source = {
      botToken: 'telegram-secret-token',
      chatId: '-100123456',
      nested: { enabled: true }
    };

    const encrypted = encryptSensitiveConfig(source);
    const serialized = JSON.stringify(encrypted);

    assert.equal(encrypted.__encrypted, true);
    assert.equal(encrypted.algorithm, 'aes-256-gcm');
    assert.equal(serialized.includes(source.botToken), false);
    assert.deepEqual(decryptSensitiveConfig(encrypted), source);
  });

  test('detecta alteração no ciphertext ou auth tag', () => {
    const encrypted = encryptSensitiveConfig({ apiKey: 'secret-key' }) as any;
    encrypted.authTag = Buffer.alloc(16, 1).toString('base64');

    assert.throws(() => decryptSensitiveConfig(encrypted));
  });

  test('mantém compatibilidade com configurações antigas em texto puro', () => {
    const legacy = { url: 'https://example.com/hook', token: 'legacy-token' };
    assert.deepEqual(decryptSensitiveConfig(legacy), legacy);
  });

  test('mascara tokens, chaves, senhas, authorization e headers', () => {
    const summary = summarizeSensitiveConfig({
      url: 'https://example.com/hook',
      botToken: 'token',
      apiKey: 'key',
      password: 'password',
      authorization: 'Bearer secret',
      headers: { 'x-secret': 'value' }
    });

    assert.equal(summary.url, 'https://example.com/hook');
    assert.equal(summary.botTokenConfigured, true);
    assert.equal(summary.apiKeyConfigured, true);
    assert.equal(summary.passwordConfigured, true);
    assert.equal(summary.authorizationConfigured, true);
    assert.equal(summary.headersConfigured, true);
    assert.equal('botToken' in summary, false);
    assert.equal('apiKey' in summary, false);
  });
});
