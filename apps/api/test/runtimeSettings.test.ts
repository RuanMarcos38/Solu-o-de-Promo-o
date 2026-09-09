import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultPlatformSettings, minimumVisibleDiscountPercent, normalizePlatformSettings, platformSettingsSchema } from '../src/runtimeSettings.js';

function settingsCopy() {
  return structuredClone(defaultPlatformSettings);
}

describe('configurações parametrizadas', () => {
  test('aceita um perfil operacional profissional válido', () => {
    const settings = settingsCopy();
    settings.branding.platformName = 'CRM R2 Marketing Digital Ofertas';
    settings.collection.intervalSeconds = 300;
    settings.qualification.minDiscountPercent = minimumVisibleDiscountPercent;
    settings.dispatch.maxOffersPerCycle = 75;
    settings.dispatch.minSecondsBetweenMessages = 10;

    assert.deepEqual(platformSettingsSchema.parse(settings), settings);
  });

  test('mantem piso comercial de 50 por cento para nao poluir a vitrine', () => {
    const settings = settingsCopy();
    settings.qualification.minDiscountPercent = 10;
    assert.equal(normalizePlatformSettings(settings).qualification.minDiscountPercent, 50);
  });

  test('bloqueia campos desconhecidos e possíveis segredos', () => {
    const settings = { ...settingsCopy(), serviceRoleKey: 'nao-pode-ser-persistida' };
    assert.throws(() => platformSettingsSchema.parse(settings), /Unrecognized key/i);
  });

  test('mantém obrigatória a verificação do link afiliado', () => {
    const settings: any = settingsCopy();
    settings.qualification.requireVerifiedAffiliateLinks = false;
    assert.throws(() => platformSettingsSchema.parse(settings));
  });

  test('aceita upgrade em memória para registros salvos antes da cadência de disparo', () => {
    const settings: any = settingsCopy();
    delete settings.dispatch.minSecondsBetweenMessages;
    const upgraded = {
      ...settings,
      dispatch: {
        ...settings.dispatch,
        minSecondsBetweenMessages: defaultPlatformSettings.dispatch.minSecondsBetweenMessages
      }
    };
    assert.deepEqual(platformSettingsSchema.parse(upgraded), upgraded);
  });

  test('valida limites, paginação e fuso horário', () => {
    const invalidInterval = settingsCopy();
    invalidInterval.collection.intervalSeconds = 30;
    assert.throws(() => platformSettingsSchema.parse(invalidInterval));

    const invalidPagination = settingsCopy();
    invalidPagination.publicApi.defaultPageSize = 100;
    invalidPagination.publicApi.maxPageSize = 50;
    assert.throws(() => platformSettingsSchema.parse(invalidPagination), /limite padrão/i);

    const invalidTimezone = settingsCopy();
    invalidTimezone.branding.timezone = 'Brasil/Sao_Paulo/Invalido';
    assert.throws(() => platformSettingsSchema.parse(invalidTimezone), /Fuso horário/i);

    const invalidDispatchCadence = settingsCopy();
    invalidDispatchCadence.dispatch.minSecondsBetweenMessages = -1;
    assert.throws(() => platformSettingsSchema.parse(invalidDispatchCadence));
  });
});
