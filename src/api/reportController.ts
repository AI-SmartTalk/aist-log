import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { config } from '../config.js';
import { getLast24hEntries, fetchKumaData, buildReportData, buildAIPrompt } from '../services/reportService.js';

export function registerReportRoutes(app: FastifyInstance): void {
  app.get('/api/logs/report', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const source = q.source;

    // Collect data
    const [entries, kumaStatus] = await Promise.all([
      getLast24hEntries(source),
      fetchKumaData(),
    ]);

    const reportData = buildReportData(entries, kumaStatus);

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send stats first
    reply.raw.write(`data: ${JSON.stringify({
      type: 'stats',
      data: {
        totalRequests: reportData.totalRequests,
        totalErrors: reportData.totalErrors,
        totalWarnings: reportData.totalWarnings,
        errorRate: reportData.errorRate,
        avgResponseTime: reportData.avgResponseTime,
        p95ResponseTime: reportData.p95ResponseTime,
        p99ResponseTime: reportData.p99ResponseTime,
        uniqueUsers: reportData.uniqueUsers,
        uniqueIPs: reportData.uniqueIPs,
        statusCodeDistribution: reportData.statusCodeDistribution,
        requestsPerHour: reportData.requestsPerHour,
        errorsPerHour: reportData.errorsPerHour,
        kumaStatus: reportData.kumaStatus.map(s => ({
          name: s.monitor.name,
          url: s.monitor.url,
          type: s.monitor.type,
          currentStatus: s.currentStatus,
          uptime24h: s.uptime24h,
          avgPing: s.avgPing,
          incidents: s.incidents.length,
        })),
        errorClusters: reportData.errorClusters.length,
        slowestEndpoints: reportData.slowestEndpoints.slice(0, 5),
        topErrorPaths: reportData.topErrorPaths.slice(0, 5),
      },
    })}\n\n`);

    // Stream AI analysis
    if (!config.openaiApiKey) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'OPENAI_API_KEY not configured' })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      reply.raw.end();
      return;
    }

    try {
      const openai = new OpenAI({ apiKey: config.openaiApiKey });
      const prompt = buildAIPrompt(reportData);

      const stream = await openai.chat.completions.create({
        model: config.aiModel,
        max_tokens: 4096,
        stream: true,
        messages: [
          { role: 'system', content: 'Tu es un expert SRE/DevOps senior. Reponds uniquement en francais avec du markdown riche et structure. Sois precis et actionnable.' },
          { role: 'user', content: prompt },
        ],
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'token', content: text })}\n\n`);
        }
      }
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'AI analysis failed' })}\n\n`);
    }

    reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    reply.raw.end();
  });
}
