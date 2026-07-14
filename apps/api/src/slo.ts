import { DispatchStatus } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { prisma } from './db.js';
import { observabilityConfig } from './observabilityConfig.js';
import {
  COLLECT_QUEUE_NAME,
  DISPATCH_DLQ_NAME,
  DISPATCH_QUEUE_NAME,
  OPERATIONAL_ALERT_QUEUE_NAME,
  collectOffersQueue,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  operationalAlertsQueue
} from './queue.js';
import { evaluateLatencySlo, evaluateRatioSlo, type SloState } from './sloRules.js';
import { runtimeTelemetrySnapshot } from './telemetry.js';

async function recentQueueLatencies(queue: Queue, windowStart: number, limit = 2_000) {
  const jobs = await queue.getJobs(['completed', 'failed'], 0, limit - 1, true);
  return jobs
    .filter((job) => (job.finishedOn ?? job.processedOn ?? job.timestamp) >= windowStart)
    .map((job) => Math.max(0, ((job.processedOn ?? job.finishedOn ?? job.timestamp) - job.timestamp) / 1000));
}

async function queueSnapshot(queueName: string, queue: Queue, windowStart: number) {
  const [counts, latencies] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused'),
    recentQueueLatencies(queue, windowStart)
  ]);
  return {
    queue: queueName,
    counts,
    latency: evaluateLatencySlo(
      latencies,
      observabilityConfig.sloQueueLatencyP95Seconds,
      observabilityConfig.sloMinimumSamples
    )
  };
}

function alertJobTimestamp(job: Job) {
  return job.finishedOn ?? job.processedOn ?? job.timestamp;
}

async function operationalAlertSli(windowStart: number) {
  const [completed, failed] = await Promise.all([
    operationalAlertsQueue.getJobs(['completed'], 0, 4_999, true),
    operationalAlertsQueue.getJobs(['failed'], 0, 4_999, true)
  ]);
  const relevantCompleted = completed.filter((job) => alertJobTimestamp(job) >= windowStart && job.data.type === 'delivery');
  const relevantFailed = failed.filter((job) => alertJobTimestamp(job) >= windowStart && job.data.type === 'delivery');
  const byChannel = new Map<string, { successful: number; failed: number }>();

  for (const job of relevantCompleted) {
    const channel = job.data.type === 'delivery' ? job.data.channel : 'unknown';
    const current = byChannel.get(channel) ?? { successful: 0, failed: 0 };
    current.successful += 1;
    byChannel.set(channel, current);
  }
  for (const job of relevantFailed) {
    const channel = job.data.type === 'delivery' ? job.data.channel : 'unknown';
    const current = byChannel.get(channel) ?? { successful: 0, failed: 0 };
    current.failed += 1;
    byChannel.set(channel, current);
  }

  const successful = relevantCompleted.length;
  const total = successful + relevantFailed.length;
  return {
    overall: evaluateRatioSlo(
      successful,
      total,
      observabilityConfig.sloOperationalAlertSuccessTarget,
      observabilityConfig.sloMinimumSamples
    ),
    byChannel: Object.fromEntries(
      [...byChannel.entries()].map(([channel, values]) => [
        channel,
        evaluateRatioSlo(
          values.successful,
          values.successful + values.failed,
          observabilityConfig.sloOperationalAlertSuccessTarget,
          observabilityConfig.sloMinimumSamples
        )
      ])
    )
  };
}

async function dispatchSli(windowStartDate: Date) {
  const groups = await prisma.dispatchLog.groupBy({
    by: ['channel', 'status'],
    where: {
      createdAt: { gte: windowStartDate },
      status: { in: [DispatchStatus.SENT, DispatchStatus.FAILED] }
    },
    _count: { _all: true }
  });
  const byChannel = new Map<string, { successful: number; failed: number }>();
  let successful = 0;
  let failed = 0;

  for (const group of groups) {
    const current = byChannel.get(group.channel) ?? { successful: 0, failed: 0 };
    if (group.status === DispatchStatus.SENT) {
      current.successful += group._count._all;
      successful += group._count._all;
    } else {
      current.failed += group._count._all;
      failed += group._count._all;
    }
    byChannel.set(group.channel, current);
  }

  return {
    overall: evaluateRatioSlo(
      successful,
      successful + failed,
      observabilityConfig.sloDispatchSuccessTarget,
      observabilityConfig.sloMinimumSamples
    ),
    byChannel: Object.fromEntries(
      [...byChannel.entries()].map(([channel, values]) => [
        channel,
        evaluateRatioSlo(
          values.successful,
          values.successful + values.failed,
          observabilityConfig.sloDispatchSuccessTarget,
          observabilityConfig.sloMinimumSamples
        )
      ])
    )
  };
}

export async function getSloSnapshot() {
  const generatedAt = new Date();
  const windowStartDate = new Date(generatedAt.getTime() - observabilityConfig.sloWindowDays * 86_400_000);
  const windowStart = windowStartDate.getTime();
  const runtime = runtimeTelemetrySnapshot();

  const [dispatch, operationalAlerts, collectQueue, dispatchQueue, dlqQueue, operationalQueue] = await Promise.all([
    dispatchSli(windowStartDate),
    operationalAlertSli(windowStart),
    queueSnapshot(COLLECT_QUEUE_NAME, collectOffersQueue, windowStart),
    queueSnapshot(DISPATCH_QUEUE_NAME, dispatchOffersQueue, windowStart),
    queueSnapshot(DISPATCH_DLQ_NAME, dispatchDeadLetterQueue, windowStart),
    queueSnapshot(OPERATIONAL_ALERT_QUEUE_NAME, operationalAlertsQueue, windowStart)
  ]);

  const apiAvailability = evaluateRatioSlo(
    runtime.api.successful,
    runtime.api.total,
    observabilityConfig.sloApiAvailabilityTarget,
    observabilityConfig.sloMinimumSamples
  );

  const objectives = [
    apiAvailability.state,
    dispatch.overall.state,
    operationalAlerts.overall.state,
    collectQueue.latency.state,
    dispatchQueue.latency.state,
    operationalQueue.latency.state
  ];
  const overallState: SloState = objectives.includes('breached')
    ? 'breached'
    : objectives.every((state) => state === 'meeting') ? 'meeting' : 'no_data';

  return {
    generatedAt: generatedAt.toISOString(),
    window: {
      configuredDays: observabilityConfig.sloWindowDays,
      persistentWindowStartedAt: windowStartDate.toISOString(),
      apiProcessStartedAt: runtime.startedAt,
      note: 'Disponibilidade HTTP é calculada desde o início do processo; distribuição e alertas usam dados persistentes da janela configurada.'
    },
    overallState,
    objectives: {
      apiAvailability,
      dispatchSuccess: dispatch,
      operationalAlertHealth: operationalAlerts,
      queueLatency: {
        targetP95Seconds: observabilityConfig.sloQueueLatencyP95Seconds,
        collect: collectQueue,
        dispatch: dispatchQueue,
        deadLetter: dlqQueue,
        operationalAlerts: operationalQueue
      }
    },
    runtime
  };
}
