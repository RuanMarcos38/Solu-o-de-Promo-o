import type { FastifyInstance } from 'fastify';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import { prisma } from './db.js';
import {
  collectOffersQueue,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  retryDeadLetterJob,
  type DispatchDeadLetterData
} from './queue.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  offset: z.coerce.number().int().min(0).max(10_000).optional().default(0)
});

const jobParamsSchema = z.object({
  jobId: z.string().trim().min(1).max(300)
});

const queueStates = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'] as const;

type QueueCounts = Record<(typeof queueStates)[number], number>;

async function readQueueCounts(queue: Queue): Promise<QueueCounts> {
  const counts = await queue.getJobCounts(...queueStates);
  return Object.fromEntries(queueStates.map((state) => [state, counts[state] ?? 0])) as QueueCounts;
}

async function serializeDeadLetter(job: Job<DispatchDeadLetterData>, state: string, lookup: {
  offers: Map<string, { id: string; title: string; marketplace: string; currentPrice: number; score: number }>;
  channels: Map<string, { id: string; name: string; type: string; isActive: boolean }>;
}) {
  const data = job.data;
  return {
    id: String(job.id),
    state,
    queuedAt: new Date(job.timestamp).toISOString(),
    failedAt: data.failedAt,
    failedReason: data.failedReason,
    attemptsMade: data.attemptsMade,
    originalJobId: data.originalJobId,
    idempotencyKey: data.idempotencyKey,
    replayOf: data.replayOf ?? null,
    matchedAlertNames: data.matchedAlertNames,
    offer: lookup.offers.get(data.offerId) ?? null,
    channel: lookup.channels.get(data.channelId) ?? null
  };
}

export async function getDispatchOperations(limit = 25, offset = 0) {
  const [collect, dispatch, deadLetter, deadLetterJobs, logGroups, recentFailures] = await Promise.all([
    readQueueCounts(collectOffersQueue),
    readQueueCounts(dispatchOffersQueue),
    readQueueCounts(dispatchDeadLetterQueue),
    dispatchDeadLetterQueue.getJobs(['waiting', 'delayed', 'failed', 'completed'], offset, offset + limit - 1, false),
    prisma.dispatchLog.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.dispatchLog.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        offer: {
          select: { id: true, title: true, marketplace: true, currentPrice: true, score: true }
        }
      }
    })
  ]);

  const offerIds = [...new Set(deadLetterJobs.map((job) => job.data.offerId))];
  const channelIds = [...new Set(deadLetterJobs.map((job) => job.data.channelId))];
  const [offers, channels, states] = await Promise.all([
    offerIds.length > 0
      ? prisma.offer.findMany({
          where: { id: { in: offerIds } },
          select: { id: true, title: true, marketplace: true, currentPrice: true, score: true }
        })
      : [],
    channelIds.length > 0
      ? prisma.dispatchChannel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true, type: true, isActive: true }
        })
      : [],
    Promise.all(deadLetterJobs.map((job) => job.getState()))
  ]);

  const offerLookup = new Map(offers.map((offer) => [offer.id, {
    ...offer,
    marketplace: String(offer.marketplace).toLowerCase(),
    currentPrice: Number(offer.currentPrice)
  }]));
  const channelLookup = new Map(channels.map((channel) => [channel.id, channel]));
  const statusTotals = Object.fromEntries(logGroups.map((group) => [group.status, group._count._all]));
  const deadLetterTotal = deadLetter.waiting + deadLetter.delayed + deadLetter.failed + deadLetter.completed;

  return {
    generatedAt: new Date().toISOString(),
    queues: { collect, dispatch, deadLetter },
    dispatchLogs: {
      pending: statusTotals.PENDING ?? 0,
      sent: statusTotals.SENT ?? 0,
      failed: statusTotals.FAILED ?? 0,
      skipped: statusTotals.SKIPPED ?? 0
    },
    recentFailures: recentFailures.map((log) => ({
      id: log.id,
      channel: log.channel,
      error: log.error,
      createdAt: log.createdAt.toISOString(),
      payload: log.payload,
      offer: log.offer ? {
        ...log.offer,
        marketplace: String(log.offer.marketplace).toLowerCase(),
        currentPrice: Number(log.offer.currentPrice)
      } : null
    })),
    deadLetters: {
      total: deadLetterTotal,
      offset,
      limit,
      items: await Promise.all(deadLetterJobs.map((job, index) => serializeDeadLetter(job, states[index], {
        offers: offerLookup,
        channels: channelLookup
      })))
    }
  };
}

export async function registerDispatchOperationsRoutes(app: FastifyInstance) {
  app.get('/admin/dispatch/operations', async (request) => {
    await requireAdmin(request);
    const query = querySchema.parse(request.query);
    return getDispatchOperations(query.limit, query.offset);
  });

  app.post('/admin/dispatch/dlq/:jobId/retry', async (request, reply) => {
    await requireAdmin(request);
    const params = jobParamsSchema.parse(request.params);
    const replay = await retryDeadLetterJob(params.jobId);
    if (!replay) {
      return reply.status(404).send({ message: 'Job não encontrado na dead-letter queue' });
    }

    return {
      status: 'requeued',
      deadLetterJobId: params.jobId,
      dispatchJobId: replay.id
    };
  });
}
