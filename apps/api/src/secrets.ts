import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

type EncryptedPayload = {
  __encrypted: true;
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  data: string;
};

const key = Buffer.from(config.channelConfigEncryptionKey, 'base64');

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<EncryptedPayload>;
  return payload.__encrypted === true && payload.version === 1 && payload.algorithm === 'aes-256-gcm';
}

export function encryptChannelConfig(value: Record<string, unknown>): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final()
  ]);

  return {
    __encrypted: true,
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  };
}

export function decryptChannelConfig(value: unknown): Record<string, unknown> {
  if (!isEncryptedPayload(value)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
}

export function summarizeChannelConfig(value: unknown) {
  const decrypted = decryptChannelConfig(value);
  const summary: Record<string, unknown> = {};

  for (const [keyName, fieldValue] of Object.entries(decrypted)) {
    if (/token|secret|key|password|authorization/i.test(keyName)) {
      summary[`${keyName}Configured`] = Boolean(fieldValue);
      continue;
    }

    if (keyName === 'headers') {
      summary.headersConfigured = Boolean(fieldValue && typeof fieldValue === 'object');
      continue;
    }

    summary[keyName] = fieldValue;
  }

  return summary;
}
