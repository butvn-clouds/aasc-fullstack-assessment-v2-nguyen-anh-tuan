/** Kiểm tra sự kiện trình duyệt bằng dữ liệu giả, không dùng thông tin xác thực hay gọi dịch vụ thật. */
describe('admin browser state', () => {
  const names = ['document', 'window', 'fetch', 'confirm'];
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  afterEach(() =>
    names.forEach((name, index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }),
  );
  function setup() {
    const createElement = () => ({
      value: '',
      textContent: '',
      disabled: false,
      children: [] as any[],
      appendChild(child: any) {
        this.children.push(child);
      },
      remove() {},
      addEventListener(name: string, fn: unknown) {
        this[name] = fn;
      },
    });
    const elements: Record<string, any> = {};
    const el = (id: string): any =>
      (elements[id] ??= {
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        children: [] as any[],
        appendChild(child: any) {
          this.children.push(child);
        },
        addEventListener(name: string, fn: unknown) {
          this[name] = fn;
        },
      });
    const events: Record<string, any> = {};
    const fetch = jest
      .fn()
      .mockResolvedValue({ status: 200, ok: true, json: async () => ({ columns: {} }) });
    const confirm = jest.fn().mockReturnValue(true);
    Object.assign(globalThis, {
      document: { getElementById: el, createElement },
      window: {
        addEventListener: (name: string, fn: unknown) => {
          events[name] = fn;
        },
      },
      fetch,
      confirm,
    });
    jest.isolateModules(() => {
      require('./admin.js');
    });
    const login = async () => {
      el('key').value = 'test-key';
      await el('login').submit({ preventDefault() {} });
    };
    return { el, events, fetch, confirm, login };
  }

  it('initializes locked controls and an informative preview', () => {
    const { el } = setup();
    expect(el('formatCode').disabled).toBe(true);
    expect(el('preview').innerHTML).toContain('Kết nối');
  });

  it('protects unapplied form edits on reload, then resets form after confirmation', async () => {
    const { el, login, fetch, confirm } = setup();
    await login();
    el('addMappingRow').onclick();
    confirm.mockReturnValue(false);
    await el('reload').onclick();
    expect(fetch).toHaveBeenCalledTimes(1);
    await el('save').onclick();
    expect(el('notice').textContent).toContain('Dùng biểu mẫu');
    confirm.mockReturnValue(true);
    await el('reload').onclick();
    expect(fetch).toHaveBeenCalledTimes(2);
    el('applyMappingForm').onclick();
    expect(el('notice').textContent).toContain('Chưa có trường');
  });

  it('validates form fields and serializes reverse mapping', async () => {
    const { el, login } = setup();
    await login();
    el('addMappingRow').onclick();
    el('applyMappingForm').onclick();
    expect(el('notice').textContent).toContain('Điền tên cột');
    const box = el('mappingRows').children[0];
    box.children[0].children[0].value = 'Owner';
    box.children[1].children[0].value = 'ASSIGNED_BY_ID';
    box.children[4].children[0].checked = true;
    el('applyMappingForm').onclick();
    expect(JSON.parse(el('editor').value).reverseColumns).toEqual({ ASSIGNED_BY_ID: 'Owner' });
  });

  it('renders row error details in persisted history as text', async () => {
    const { el, login, fetch } = setup();
    await login();
    fetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        runs: [
          {
            startedAt: '2026-01-01',
            direction: 'webhook',
            status: 'partial',
            details: [{ rowNumber: 2, code: 'INVALID', message: 'Invalid status' }],
          },
        ],
      }),
    });
    await el('refreshHistory').onclick();
    expect(el('historyOutput').textContent).toContain('Dòng 2: [INVALID] Invalid status');
  });

  it('tracks edits, prevents unsaved sync and allows cancelling logout', async () => {
    const { el, login, fetch, confirm, events } = setup();
    await login();
    el('editor').value = '{"columns":{"Email":"EMAIL"}}';
    el('editor').oninput();
    el('formatCode').onclick();
    const event = { preventDefault: jest.fn(), returnValue: undefined };
    events.beforeunload(event);
    expect(event.preventDefault).toHaveBeenCalled();
    await el('forward').onclick();
    expect(fetch).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(false);
    el('logout').onclick();
    expect(el('editor').value).toContain('EMAIL');
    fetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ columns: { Email: 'EMAIL' } }),
    });
    await el('save').onclick();
    expect(el('preview').innerHTML).toContain('EMAIL');
    event.preventDefault.mockClear();
    events.beforeunload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('clears the previous session on unauthorized responses', async () => {
    const { el, login, fetch } = setup();
    await login();
    fetch.mockResolvedValueOnce({ status: 401, ok: false });
    await el('reload').onclick();
    expect(el('editor').value).toBe('');
    expect(el('preview').innerHTML).not.toContain('columns');
    expect(el('forward').disabled).toBe(true);
    expect(el('logout').hidden).toBe(true);
  });

  it('reports non-JSON errors and releases busy controls without retrying', async () => {
    const { el, login, fetch } = setup();
    await login();
    fetch.mockResolvedValueOnce({
      status: 502,
      ok: false,
      json: async () => {
        throw new Error('HTML');
      },
    });
    await el('forward').onclick();
    expect(el('notice').textContent).toContain('502');
    expect(el('forward').disabled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('escapes HTML in JSON previews', async () => {
    const { el, login, fetch } = setup();
    fetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ value: '<img onerror=alert(1)>' }),
    });
    await login();
    expect(el('preview').innerHTML).not.toContain('<img');
    expect(el('preview').innerHTML).toContain('&lt;img');
  });
});
