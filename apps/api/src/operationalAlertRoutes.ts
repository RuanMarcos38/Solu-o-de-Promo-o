import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.js';
import {
  enqueueTestOperationalAlert,
  monitorDlqThreshold,
  operationalAlertQueueStatus
} from './operationalAlerts.js';

export async function registerOperationalAlertRoutes(app: FastifyInstance) {
  app.get('/admin/operational-alerts/status', async (request) => {
    await requireAdmin(request);
    return operationalAlertQueueStatus();
  });

  app.post('/admin/operational-alerts/test', async (request, reply) => {
    const user = await requireAdmin(request);
    const jobs = await enqueueTestOperationalAlert(user.email);
    return reply.status(202).send({
      status: 'queued',
      channels: jobs.map((job) => ({ channel: job.channel, jobId: job.jobId, created: job.created }))
    });
  });

  app.post('/admin/operational-alerts/check', async (request) => {
    await requireAdmin(request);
    return monitorDlqThreshold();
  });
}