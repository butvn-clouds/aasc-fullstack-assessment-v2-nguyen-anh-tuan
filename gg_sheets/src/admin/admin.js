(function () {
  'use strict';
  const el = (id) => document.getElementById(id);
  let key = '',
    busy = false,
    dirty = false,
    formDirty = false,
    savedText = '';
  let formRows = [];
  function resetForm() {
    formRows = [];
    formDirty = false;
    if (el('mappingRows')) el('mappingRows').textContent = '';
  }
  function highlight(text) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.replace(
      /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
      (match, str, colon, literal) =>
        '<span class="json-' +
        (colon ? 'key' : str ? 'string' : literal ? 'literal' : 'number') +
        '">' +
        match +
        '</span>',
    );
  }
  function refreshPreview() {
    el('preview').innerHTML =
      highlight(el('editor').value) || 'Kết nối để tải cấu hình…';
  }
  el('toggleCode').onclick = () => {
    const editing = el('editor').hidden;
    el('editor').hidden = !editing;
    el('preview').hidden = editing;
    el('toggleCode').textContent = editing ? 'Xem JSON' : 'Chỉnh sửa';
    refreshPreview();
  };
  el('formatCode').onclick = () => {
    if (!key || busy) return;
    try {
      el('editor').value = JSON.stringify(JSON.parse(el('editor').value), null, 2);
      markDirty();
      refreshPreview();
    } catch {
      message('JSON chưa hợp lệ, chưa thể định dạng.', true);
    }
  };
  function message(text, error = false) {
    el('notice').hidden = false;
    el('notice').textContent = text;
    el('notice').className = 'notice' + (error ? ' error' : '');
  }
  function controls() {
    el('checkConnections').disabled = busy || !key;
    formRows.forEach((row) =>
      Object.values(row).forEach((control) => {
        if (control && 'disabled' in control) control.disabled = busy || !key;
      }),
    );
    ['reload', 'save', 'forward', 'reverse', 'editor', 'toggleCode', 'formatCode'].forEach(
      (id) => (el(id).disabled = busy || !key),
    );
    el('connect').disabled = busy;
    el('logout').disabled = busy;
    el('key').disabled = busy;
    [
      'refreshHistory',
      'loadMappingForm',
      'addMappingRow',
      'presetReverse',
      'applyMappingForm',
    ].forEach((id) => {
      if (el(id)) el(id).disabled = busy || !key;
    });
  }
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetch('/api/v1/sync' + path, {
        method,
        cache: 'no-store',
        headers: {
          'x-api-key': key,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(
        'Mất kết nối máy chủ. Yêu cầu có thể đã được xử lý; kiểm tra trạng thái trước khi chạy lại.',
      );
    }
    if (response.status === 401) {
      clearSession();
      throw new Error('Khóa API không hợp lệ hoặc đã thay đổi. Vui lòng kết nối lại.');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        'Máy chủ trả về nội dung không phải JSON (HTTP ' +
          response.status +
          '). Hãy kiểm tra máy chủ trước khi thử lại.',
      );
    }
    if (!response.ok)
      throw new Error(
        Array.isArray(data?.message)
          ? data.message.join(', ')
          : data?.message || 'Yêu cầu không thành công (HTTP ' + response.status + ').',
      );
    return data;
  }
  async function task(fn) {
    if (busy) return;
    busy = true;
    controls();
    try {
      await fn();
    } catch (error) {
      message(error.message || 'Không thể kết nối máy chủ.', true);
    } finally {
      busy = false;
      controls();
    }
  }
  async function load() {
    const data = await api('/admin/config');
    el('editor').value = JSON.stringify(data, null, 2);
    refreshPreview();
    savedText = el('editor').value;
    dirty = false;
    formDirty = false;
    el('editorHint').textContent = 'Đã tải cấu hình · ' + new Date().toLocaleTimeString('vi-VN');
    resetForm();
  }
  el('login').addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || !discardChanges()) return;
    const nextKey = el('key').value.trim();
    if (!nextKey) return;
    return task(async () => {
      clearSession();
      key = nextKey;
      try {
        await load();
        el('badge').textContent = 'Đã xác thực';
        el('badge').className = 'badge online';
        el('logout').hidden = false;
        el('key').value = '';
        message('Kết nối thành công. Không gian làm việc đã sẵn sàng.');
      } catch (error) {
        clearSession();
        throw error;
      }
    });
  });
  function clearSession() {
    el('connectionOutput').textContent = '';
    resetForm();
    formDirty = false;
    key = '';
    el('key').value = '';
    el('editor').value = '';
    el('output').textContent = '';
    if (el('historyOutput')) el('historyOutput').textContent = '';
    if (el('mappingRows')) el('mappingRows').textContent = '';
    el('empty').hidden = false;
    el('logout').hidden = true;
    el('badge').textContent = 'Chưa xác thực';
    el('badge').className = 'badge';
    ['created', 'updated', 'skipped', 'errors'].forEach((id) => (el(id).textContent = '—'));
    dirty = false;
    savedText = '';
    el('editor').hidden = true;
    el('preview').hidden = false;
    el('toggleCode').textContent = 'Chỉnh sửa';
    el('editorHint').textContent = 'Kết nối không gian làm việc để tải cấu hình.';
    refreshPreview();
    controls();
  }
  el('logout').onclick = () => {
    if (busy || !discardChanges()) return;
    clearSession();
    message('Đã kết thúc phiên làm việc.');
  };
  function markDirty() {
    dirty = el('editor').value !== savedText;
    el('editorHint').textContent = dirty ? 'Có thay đổi chưa lưu' : 'Không có thay đổi chưa lưu';
  }
  function discardChanges() {
    return !(dirty || formDirty) || confirm('Có thay đổi chưa lưu sẽ bị bỏ. Tiếp tục?');
  }
  el('editor').oninput = markDirty;
  el('reload').onclick = () => {
    if (busy || !discardChanges()) return;
    return task(async () => {
      await load();
      message('Đã tải lại cấu hình.');
    });
  };
  el('save').onclick = () =>
    task(async () => {
      if (formDirty) throw new Error('Bấm “Dùng biểu mẫu” trước khi lưu.');
      let config;
      try {
        config = JSON.parse(el('editor').value);
      } catch {
        throw new Error('JSON chưa hợp lệ. Hãy kiểm tra dấu phẩy, dấu ngoặc và dấu nháy.');
      }
      const saved = await api('/admin/config', 'PUT', config);
      el('editor').value = JSON.stringify(saved, null, 2);
      savedText = el('editor').value;
      refreshPreview();
      dirty = false;
      el('editorHint').textContent = 'Đã lưu · ' + new Date().toLocaleTimeString('vi-VN');
      message('Đã lưu cấu hình ánh xạ.');
    });
  async function run(path) {
    if (dirty || formDirty) {
      message('Hãy lưu hoặc tải lại cấu hình trước khi đồng bộ.', true);
      return;
    }
    await task(async () => {
      message('Đang đồng bộ dữ liệu. Vui lòng chờ…');
      const data = await api(path, 'POST');
      el('empty').hidden = true;
      el('output').innerHTML = highlight(JSON.stringify(data, null, 2));
      el('created').textContent = data.created ?? '—';
      el('updated').textContent = data.updated ?? data.pulledDown ?? '—';
      el('skipped').textContent = data.skipped ?? '—';
      el('errors').textContent = data.errors ?? '—';
      message(
        data.errors
          ? 'Đồng bộ xong, có ' + data.errors + ' lỗi. Xem chi tiết bên dưới.'
          : 'Đồng bộ hoàn tất · ' + new Date().toLocaleTimeString('vi-VN'),
        !!data.errors,
      );
    });
  }
  el('forward').onclick = () => run('/run');
  el('reverse').onclick = () => run('/reverse-run');
  if (typeof document.createElement === 'function') {
    function inputRow(column = '', field = '', transform = {}, reverse = false) {
      const box = document.createElement('div');
      box.className = 'mapping-row';
      box.addEventListener('input', () => {
        formDirty = true;
      });
      const control = (title, type, value) => {
        const label = document.createElement('label');
        label.textContent = title;
        const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') input.type = type;
        if (type === 'checkbox') input.checked = !!value;
        else input.value = value ?? '';
        label.appendChild(input);
        box.appendChild(label);
        return input;
      };
      const row = {
        box,
        column: control('Tên cột bảng tính', 'text', column),
        field: control(
          'Mã trường CRM (STATUS_ID, ASSIGNED_BY_ID, EMAIL[0][VALUE]...)',
          'text',
          field,
        ),
      };
      const label = document.createElement('label');
      label.textContent = 'Kiểu dữ liệu';
      row.type = document.createElement('select');
      [
        ['string', 'Văn bản'],
        ['number', 'Số'],
        ['enum', 'Danh sách nhãn → mã'],
        ['enum_normalized', 'Mã trạng thái CRM'],
        ['multi_value', 'Nhiều email/điện thoại'],
        ['date', 'Ngày tháng'],
      ].forEach(([value, title]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = title;
        row.type.appendChild(option);
      });
      row.type.value = transform.type || 'string';
      label.appendChild(row.type);
      box.appendChild(label);
      row.required = control('Bắt buộc', 'checkbox', transform.required);
      row.reverse = control('Lấy về từ Bitrix', 'checkbox', reverse);
      row.enums = control(
        'Danh sách giá trị: mỗi dòng Nhãn=Mã',
        'textarea',
        Object.entries(transform.values || {})
          .map(([key, value]) => key + '=' + value)
          .join('\n'),
      );
      row.separator = control('Dấu phân cách nhiều giá trị', 'text', transform.separator || ';');
      row.valueType = control(
        'Loại liên hệ (WORK, MOBILE, HOME)',
        'text',
        transform.valueType || 'WORK',
      );
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn';
      remove.textContent = 'Bỏ trường';
      remove.onclick = () => {
        if (busy || !key) return;
        box.remove();
        formDirty = true;
        formRows = formRows.filter((item) => item !== row);
      };
      box.appendChild(remove);
      formRows.push(row);
      el('mappingRows').appendChild(box);
    }
    el('loadMappingForm').onclick = () => {
      if (!key || busy) return;
      if (formDirty && !confirm('Bỏ các thay đổi chưa áp dụng trong biểu mẫu?')) return;
      try {
        const config = JSON.parse(el('editor').value);
        formRows = [];
        el('mappingRows').textContent = '';
        Object.entries(config.columns).forEach(([column, field]) =>
          inputRow(
            column,
            field,
            config.transforms?.[column],
            config.reverseColumns
              ? config.reverseColumns[field] === column
              : ['STATUS_ID', 'ASSIGNED_BY_ID'].includes(field),
          ),
        );
        formDirty = false;
        message('Đã tải biểu mẫu. Sửa → Dùng biểu mẫu → Lưu thay đổi.');
      } catch {
        message('Cần tải cấu hình JSON hợp lệ trước.', true);
      }
    };
    el('addMappingRow').onclick = () => {
      if (key && !busy) {
        inputRow();
        formDirty = true;
      }
    };
    el('presetReverse').onclick = () => {
      if (!key || busy) return;
      if (!formRows.length) {
        message('Bấm “Đọc cấu hình vào biểu mẫu” trước.', true);
        return;
      }
      formDirty = true;
      for (const [column, field] of [
        ['Trạng thái', 'STATUS_ID'],
        ['Người phụ trách', 'ASSIGNED_BY_ID'],
      ]) {
        const found = formRows.find((row) => row.column.value === column);
        if (found) {
          found.field.value = field;
          found.reverse.checked = true;
          if (field === 'STATUS_ID' && found.type.value !== 'enum')
            found.type.value = 'enum_normalized';
        } else
          inputRow(
            column,
            field,
            { type: field === 'STATUS_ID' ? 'enum_normalized' : 'string' },
            true,
          );
      }
      message(
        'Đã chọn trường CRM chuẩn. Người phụ trách phải nhập ID số; trạng thái phải dùng ID đúng trên portal. Áp dụng và lưu để kích hoạt.',
      );
    };
    el('applyMappingForm').onclick = () => {
      if (!key || busy) return;
      try {
        if (!formRows.length) throw new Error('Chưa có trường. Hãy đọc cấu hình vào biểu mẫu trước.');
        const config = JSON.parse(el('editor').value),
          columns = {},
          transforms = {},
          reverseColumns = {};
        for (const row of formRows) {
          const column = row.column.value.trim(),
            field = row.field.value.trim();
          if (!column || !/^[A-Z][A-Z0-9_]*(?:\[0\]\[VALUE\])?$/.test(field))
            throw new Error('Điền tên cột và mã CRM đúng, ví dụ STATUS_ID.');
          if (Object.hasOwn(columns, column)) throw new Error('Tên cột bảng tính bị trùng: ' + column);
          columns[column] = field;
          const transform = { type: row.type.value, required: row.required.checked };
          if (transform.type === 'enum') {
            transform.values = {};
            for (const line of row.enums.value.split('\n').filter((line) => line.trim())) {
              const pos = line.indexOf('='),
                label = line.slice(0, pos).trim(),
                id = line.slice(pos + 1).trim();
              if (pos < 1 || !id || Object.hasOwn(transform.values, label))
                throw new Error('Mỗi dòng cần theo dạng Nhãn=Mã và nhãn không được trùng.');
              transform.values[label] = id;
            }
            if (!Object.keys(transform.values).length) throw new Error('Chưa nhập giá trị danh sách.');
          }
          if (transform.type === 'multi_value') {
            transform.separator = row.separator.value;
            transform.valueType = row.valueType.value;
            if (!transform.separator) throw new Error('Dấu phân cách không được rỗng.');
          }
          transforms[column] = transform;
          if (row.reverse.checked) {
            if (Object.hasOwn(reverseColumns, field))
              throw new Error('Không thể lấy một trường CRM về nhiều cột trong biểu mẫu.');
            reverseColumns[field] = column;
          }
        }
        config.columns = columns;
        config.transforms = transforms;
        config.reverseColumns = reverseColumns;
        config.dedupFields = (config.dedupFields || []).filter((column) =>
          Object.hasOwn(columns, column),
        );
        config.additionalFields = Object.fromEntries(
          Object.entries(config.additionalFields || {}).filter(([, column]) =>
            Object.hasOwn(columns, column),
          ),
        );
        el('editor').value = JSON.stringify(config, null, 2);
        formDirty = false;
        markDirty();
        refreshPreview();
        message('Đã áp dụng biểu mẫu vào bản nháp. Bấm “Lưu thay đổi” để sử dụng.');
      } catch (error) {
        message(error.message, true);
      }
    };
    el('refreshHistory').onclick = () =>
      task(async () => {
        const data = await api('/admin/history');
        const names = {
          sheet_to_crm: 'Bảng tính → CRM',
          crm_to_sheet: 'CRM → Bảng tính',
          webhook: 'Thông báo tự động từ Bitrix',
        };
        const statuses = {
          running: 'Đang chạy',
          success: 'Thành công',
          partial: 'Có dòng bị lỗi',
          failed: 'Thất bại',
          interrupted: 'Bị gián đoạn khi ứng dụng khởi động lại',
        };
        el('historyOutput').textContent =
          (data.persistenceError ? 'Cảnh báo: không đọc hoặc ghi được lịch sử trên ổ lưu trữ.\n' : '') +
          (data.runs
            .map((run) =>
              [
                new Date(run.startedAt).toLocaleString('vi-VN'),
                names[run.direction] || run.direction,
                statuses[run.status] || run.status,
                run.summary ? JSON.stringify(run.summary) : '',
                run.error?.message || '',
                ...(run.details || []).map(
                  (detail) =>
                    '\nDòng ' +
                    (detail.rowNumber ?? '—') +
                    ': [' +
                    detail.code +
                    '] ' +
                    detail.message,
                ),
              ]
                .filter(Boolean)
                .join(' · '),
            )
            .join('\n\n') || 'Chưa có lần đồng bộ nào.');
      });
  }
  window.addEventListener('beforeunload', (event) => {
    if (dirty || formDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  refreshPreview();
  controls();
  el('checkConnections').onclick = () =>
    task(async () => {
      const data = await api('/admin/connections/check', 'POST');
      el('connectionOutput').textContent = [
        'Thời điểm kiểm tra: ' + new Date(data.checkedAt).toLocaleString('vi-VN'),
        'Google: ' + data.google.message,
        'Bitrix: ' + data.bitrix.message,
        'Quy tắc xử lý xung đột: ' + data.strategy,
        'Địa chỉ nhận webhook ra: ' +
          (data.webhook.receiverUrl ||
            'Hãy đặt PUBLIC_BASE_URL thành địa chỉ HTTPS công khai rồi khởi động lại ứng dụng.'),
        'Mã xác thực webhook ra: ' +
          (data.webhook.tokenConfigured ? 'Đã cấu hình' : 'Chưa cấu hình BITRIX24_WEBHOOK_SECRET'),
        data.webhook.message,
      ].join('\n');
    });
})();
