// Kiểm tra tải nhẹ chỉ đọc; không gửi webhook hoặc tạo dữ liệu CRM.
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
  const duration = Number(process.env.SMOKE_SECONDS || 60);
  const connections = Number(process.env.SMOKE_STREAMS || 20);
  if (
    !Number.isInteger(duration) ||
    duration < 10 ||
    duration > 600 ||
    !Number.isInteger(connections) ||
    connections < 1 ||
    connections > 50
  ) {
    throw new Error('SMOKE_SECONDS phải từ 10–600; SMOKE_STREAMS từ 1–50');
  }
  const headers = process.env.ADMIN_API_KEY ? { 'X-API-Key': process.env.ADMIN_API_KEY } : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), duration * 1000);
  const start = Date.now();
  const firstEvents = new Set();
  let events = 0;
  const failures = [];
  const latency = [];
  const streams = Array.from({ length: connections }, async (_, index) => {
    try {
      const response = await fetch(`${origin}/api/v1/analytics/stream?date_range=30d`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`SSE HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Sai kiểu dữ liệu SSE');
      const decoder = new TextDecoder();
      let pending = '';
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const event = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          if (/event: ?statistics/.test(event)) {
            const data = event
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5))
              .join('\n');
            const parsed = JSON.parse(data);
            if (!parsed.conversion || !Array.isArray(parsed.campaigns)) throw new Error('Sai dữ liệu thống kê');
            firstEvents.add(index);
            events++;
          }
        }
      }
      if (!controller.signal.aborted) throw new Error('SSE đóng kết nối sớm');
    } catch (error) {
      if (!controller.signal.aborted) failures.push(error.message);
    }
  });
  const polling = (async () => {
    while (!controller.signal.aborted) {
      const began = Date.now();
      try {
        const response = await fetch(`${origin}/api/v1/analytics/conversion-rates?date_range=30d`, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Thống kê HTTP ${response.status}`);
        const body = await response.json();
        if (!body.overall || !Array.isArray(body.campaigns)) throw new Error('Sai dữ liệu API');
        latency.push(Date.now() - began);
        await delay(2000, undefined, { signal: controller.signal });
      } catch (error) {
        if (!controller.signal.aborted) failures.push(error.message);
        break;
      }
    }
  })();
  try {
    await Promise.all([...streams, polling]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  latency.sort((a, b) => a - b);
  const result = {
    seconds: Math.round((Date.now() - start) / 1000),
    connections,
    streamsWithData: firstEvents.size,
    events,
    requests: latency.length,
    p95Ms: latency[Math.max(0, Math.ceil(latency.length * 0.95) - 1)] ?? null,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length || firstEvents.size !== connections || !latency.length) process.exitCode = 1;
}

main().catch(() => {
  console.error('Không hoàn tất kiểm tra tải nhẹ');
  process.exitCode = 1;
});
