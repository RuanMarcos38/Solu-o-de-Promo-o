import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';

export const PLATFORM_SETTINGS_ID = 'default';

const timeZoneSchema = z.string().trim().min(1).max(80).refine((value) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário IANA inválido');

export const platformSettingsSchema = z.object({
  branding: z.object({
    platformName: z.string().trim().min(2).max(80),
    timezone: timeZoneSchema,
    locale: z.literal('pt-BR'),
    currency: z.literal('BRL')
  }).strict(),
  collection: z.object({
    automaticEnabled: z.boolean(),
    intervalSeconds: z.number().int().min(60).max(86_400),
    maxResultsPerSource: z.number().int().min(1).max(100)
  }).strict(),
  qualification: z.object({
    minDiscountPercent: z.number().min(0).max(100),
    minOpportunityScore: z.number().int().min(0).max(100),
    requireVerifiedAffiliateLinks: z.literal(true)
  }).strict(),
  dispatch: z.object({
    automaticEnabled: z.boolean(),
    maxOffersPerCycle: z.number().int().min(1).max(500)
  }).strict(),
  publicApi: z.object({
    enabled: z.boolean(),
    defaultPageSize: z.number().int().min(1).max(100),
    maxPageSize: z.number().int().min(1).max(200)
  }).strict().refine((value) => value.defaultPageSize <= value.maxPageSize, {
    message: 'O limite padrão não pode ser maior que o limite máximo',
    path: ['defaultPageSize']
  })
}).strict();

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const defaultPlatformSettings: PlatformSettings = platformSettingsSchema.parse({
  branding: {
    platformName: 'Zenite Ofertas',
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    currency: 'BRL'
  },
  collection: {
    automaticEnabled: true,
    intervalSeconds: config.collectIntervalSeconds,
    maxResultsPerSource: config.maxResultsPerSource
  },
  qualification: {
    minDiscountPercent: config.minDiscountPercent,
    minOpportunityScore: config.minOpportunityScore,
    requireVerifiedAffiliateLinks: true
  },
  dispatch: {
    automaticEnabled: true,
    maxOffersPerCycle: 100
  },
  publicApi: {
    enabled: true,
    defaultPageSize: 50,
    maxPageSize: 200
  }
});

export type PlatformSettingsRecord = {
  settings: PlatformSettings;
  version: number;
  updatedBy: string | null;
  updatedAt: Date | null;
  source: 'database' | 'environment-defaults';
};

export class SettingsVersionConflictError extends Error {
  statusCode = 409;

  constructor() {
    super('As configurações foram alteradas por outro administrador. Atualize o painel e tente novamente.');
  }
}

export async function getPlatformSettings(): Promise<PlatformSettingsRecord> {
  const record = await prisma.platformSetting.findUnique({ where: { id: PLATFORM_SETTINGS_ID } });
  if (!record) {
    return {
      settings: defaultPlatformSettings,
      version: 0,
      updatedBy: null,
      updatedAt: null,
      source: 'environment-defaults'
    };
  }

  return {
    settings: platformSettingsSchema.parse(record.value),
    version: record.version,
    updatedBy: record.updatedBy,
    updatedAt: record.updatedAt,
    source: 'database'
  };
}

export async function savePlatformSettings(input: {
  settings: unknown;
  expectedVersion: number;
  updatedBy: string;
}): Promise<PlatformSettingsRecord> {
  const settings = platformSettingsSchema.parse(input.settings);

  let saved;
  try {
    saved = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.platformSetting.findUnique({ where: { id: PLATFORM_SETTINGS_ID } });
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== input.expectedVersion) throw new SettingsVersionConflictError();

      const nextVersion = currentVersion + 1;
      const value = settings as Prisma.InputJsonValue;
      let record;
      if (existing) {
        const update = await transaction.platformSetting.updateMany({
          where: { id: PLATFORM_SETTINGS_ID, version: currentVersion },
          data: { value, version: nextVersion, updatedBy: input.updatedBy }
        });
        if (update.count !== 1) throw new SettingsVersionConflictError();
        record = await transaction.platformSetting.findUniqueOrThrow({ where: { id: PLATFORM_SETTINGS_ID } });
      } else {
        record = await transaction.platformSetting.create({
          data: { id: PLATFORM_SETTINGS_ID, value, version: nextVersion, updatedBy: input.updatedBy }
        });
      }

      await transaction.platformSettingAudit.create({
        data: {
          settingId: PLATFORM_SETTINGS_ID,
          version: nextVersion,
          ...(existing ? { previousValue: existing.value as Prisma.InputJsonValue } : {}),
          value,
          updatedBy: input.updatedBy
        }
      });

      return record;
    });
  } catch (error) {
    if (error instanceof SettingsVersionConflictError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new SettingsVersionConflictError();
    }
    throw error;
  }

  return {
    settings,
    version: saved.version,
    updatedBy: saved.updatedBy,
    updatedAt: saved.updatedAt,
    source: 'database'
  };
}

export async function listPlatformSettingsAudit(limit = 20) {
  return prisma.platformSettingAudit.findMany({
    where: { settingId: PLATFORM_SETTINGS_ID },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      version: true,
      updatedBy: true,
      createdAt: true
    }
  });
}
