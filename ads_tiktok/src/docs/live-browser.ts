import type { StatisticsSnapshot } from '../analytics/analytics-stream.service';
export interface DocsAuth {
  admin?: { value?: string };
  session?: { value?: string };
}

/** Hàm trình duyệt độc lập, được TypeScript kiểm tra trước khi nhúng vào Swagger. */
export function mountLivePanel(panel: HTMLElement, template: string, getAuth: () => DocsAuth): () => void {
  panel.className = 'analytics-live-panel';
  panel.dataset.state = 'idle';
  panel.innerHTML = template;
  const required = <T extends Element>(selector: string): T => {
    const element = panel.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử giao diện Swagger: ${selector}`);
    return element;
  };
  const input = required<HTMLInputElement>('.live-controls input');
  const start = required<HTMLButtonElement>('.live-start');
  const stop = required<HTMLButtonElement>('.live-stop');
  const status = required<HTMLElement>('[role="status"]');
  const output = required<HTMLElement>('pre');
  const badge = required<HTMLElement>('.live-badge');
  const metrics = Array.from(panel.querySelectorAll<HTMLElement>('[data-metric]'));
  let controller: AbortController | undefined;
  const setState = (state: 'idle' | 'connecting' | 'live' | 'error', label: string) => {
    panel.dataset.state = state;
    badge.textContent = label;
  };
  const clearMetrics = () => {
    metrics.forEach((node) => (node.textContent = '—'));
  };
  const renderSnapshot = (snapshot: StatisticsSnapshot) => {
    output.textContent = JSON.stringify(snapshot, null, 2);
    const overall = snapshot.conversion?.overall as Record<string, unknown> | undefined;
    metrics.forEach((node) => {
      const metric = node.dataset.metric;
      const value = metric ? overall?.[metric] : undefined;
      if (typeof value !== 'number') {
        node.textContent = '—';
      } else if (metric === 'lead_to_deal') {
        node.textContent = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 2 }).format(value);
      } else {
        node.textContent = new Intl.NumberFormat('vi-VN').format(value);
      }
    });
    status.textContent =
      'Đang theo dõi · Cập nhật lúc ' + new Date().toLocaleTimeString('vi-VN') + ' · Chỉ gửi tiếp khi số liệu thay đổi';
  };
  stop.onclick = () => controller?.abort();
  const close = () => controller?.abort();
  window.addEventListener('pagehide', close);
  start.onclick = async () => {
    controller = new AbortController();
    start.disabled = true;
    stop.disabled = false;
    input.disabled = true;
    output.textContent = '';
    clearMetrics();
    setState('connecting', 'Đang kết nối');
    status.textContent = 'Đang kết nối…';
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const auth = getAuth();
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (auth.admin?.value) headers['X-API-Key'] = auth.admin.value;
      else if (auth.session?.value) headers.Authorization = `Bearer ${auth.session.value.replace(/^Bearer\s+/i, '')}`;
      const url = new URL('/api/v1/analytics/stream', window.location.origin);
      url.searchParams.set('date_range', input.value.trim());
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (await response.text()));
      if (!response.body) throw new Error('Máy chủ không trả luồng dữ liệu');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      status.textContent = 'Đã kết nối, đang chờ số liệu…';
      setState('live', 'Đang theo dõi');
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const lines = event.split(/\r?\n/);
          const data = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          if (lines.some((line) => /^event:\s*error$/.test(line))) throw new Error(data);
          const snapshot = JSON.parse(data) as StatisticsSnapshot;
          renderSnapshot(snapshot);
        }
      }
      status.textContent = 'Kết nối đã đóng. Bấm Bắt đầu để kết nối lại.';
      setState('idle', 'Đã ngắt kết nối');
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      status.textContent = error.name === 'AbortError' ? 'Đã dừng' : 'Không thể theo dõi: ' + error.message;
      setState(error.name === 'AbortError' ? 'idle' : 'error', error.name === 'AbortError' ? 'Đã dừng' : 'Lỗi kết nối');
    } finally {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      start.disabled = false;
      stop.disabled = true;
      input.disabled = false;
    }
  };
  return () => {
    close();
    window.removeEventListener('pagehide', close);
    start.onclick = null;
    stop.onclick = null;
  };
}
