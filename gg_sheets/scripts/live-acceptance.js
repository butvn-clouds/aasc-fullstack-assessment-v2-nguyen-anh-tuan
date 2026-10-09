/* Chạy thủ công bên trong image đã build; tạo một tab Sheet riêng và một khách hàng tiềm năng kiểm thử.
 * Giữ lại kết quả để đối chiếu. Không dùng liên hệ khách hàng thật làm dữ liệu kiểm thử. */
const fs = require('fs');
const assert = require('node:assert/strict');
const root = '/app/dist';
const { Logger } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const configuration = require(`${root}/config/configuration`).default;
const { GoogleSheetsService } = require(`${root}/google-sheets/google-sheets.service`);
const { Bitrix24ClientService } = require(`${root}/bitrix24/bitrix24-client.service`);
const { SyncService } = require(`${root}/sync/sync.service`);
const { TwoWaySyncService } = require(`${root}/sync/two-way-sync.service`);
const { CrmPreflightService } = require(`${root}/sync/crm-preflight.service`);
const { CreateJournalService } = require(`${root}/sync/create-journal.service`);
Logger.overrideLogger(false);
const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
const tab = `KIỂM THỬ_${stamp}`;
const dir = `/app/data/acceptance/${stamp}`;
fs.mkdirSync(dir, { recursive: true });
const report = { startedAt: new Date().toISOString(), tab, checks: [], leadId: null };
const save = () => fs.writeFileSync(`${dir}/result.json`, JSON.stringify(report, null, 2));
const record = (name, result) => {
  report.checks.push({ name, passed: true, result });
  save();
  console.log(JSON.stringify({ name, passed: true, result }));
};
async function main() {
  // ConfigService v3 ưu tiên process.env hơn các giá trị truyền vào hàm khởi tạo.
  // Các giá trị ghi đè này chỉ áp dụng trong container kiểm thử riêng.
  process.env.SYNC_DIRECTION = 'forward';
  process.env.CONFLICT_RESOLUTION_STRATEGY = 'bitrix_wins';
  process.env.SYNC_HISTORY_DIR = dir;
  const base = configuration();
  base.google.worksheetName = tab;
  const cfg = new ConfigService({
    ...base,
    SYNC_DIRECTION: 'forward',
    CONFLICT_RESOLUTION_STRATEGY: 'bitrix_wins',
    SYNC_HISTORY_DIR: dir,
  });
  const bitrix = new Bitrix24ClientService(cfg);
  const preflight = new CrmPreflightService(bitrix);
  await preflight.assertClassic();
  const sheets = new GoogleSheetsService(cfg);
  await sheets.onModuleInit();
  const api = sheets.sheetsClient;
  const spreadsheetId = base.google.sheetId;
  const email = `acceptance-${stamp}@example.com`;
  let phone;
  for (let n = 10; n < 100; n++) {
    const candidate = `+120255501${n}`;
    if (!(await bitrix.findLeadByEmailOrPhone(email, candidate))) {
      phone = candidate;
      break;
    }
  }
  assert.ok(phone, 'Không tìm được email và số điện thoại chưa được sử dụng để kiểm thử');
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
  });
  save();
  const mapping = {
    columns: {
      Name: 'TITLE',
      Email: 'EMAIL[0][VALUE]',
      Phone: 'PHONE[0][VALUE]',
      Status: 'STATUS_ID',
    },
    statusColumns: {
      leadId: 'ID',
      syncHash: 'Hash',
      syncStatus: 'Sync',
      errorMessage: 'Error',
      lastSyncedAt: 'Time',
      crmModifiedAt: 'CrmTime',
    },
    dedupFields: ['Email', 'Phone'],
    reverseColumns: {
      TITLE: 'Name',
      'EMAIL[0][VALUE]': 'Email',
      'PHONE[0][VALUE]': 'Phone',
      STATUS_ID: 'Status',
    },
    transforms: {
      Name: { type: 'string', required: true },
      Email: { type: 'multi_value' },
      Phone: { type: 'multi_value' },
      Status: { type: 'enum', values: { 'Mới': 'NEW', 'Đang xử lý': 'IN_PROCESS' } },
    },
  };
  const headers = [...Object.keys(mapping.columns), ...Object.values(mapping.statusColumns)];
  const range = `'${tab}'!A1:J20`;
  const write = async (rows) => {
    await api.spreadsheets.values.clear({ spreadsheetId, range });
    await api.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tab}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))] },
    });
  };
  const patch = async (rowNumber, values) =>
    sheets.writeStatusBatch(headers, [{ rowNumber, values }]);
  const forward = new SyncService(
    sheets,
    bitrix,
    { get: () => mapping },
    cfg,
    undefined,
    preflight,
    new CreateJournalService(cfg),
  );
  const reverse = new TwoWaySyncService(
    sheets,
    bitrix,
    { get: () => mapping },
    cfg,
    undefined,
    preflight,
  );
  let writes = 0;
  const batchWrite = bitrix.batchWrite.bind(bitrix);
  bitrix.batchWrite = async (...args) => {
    writes++;
    return batchWrite(...args);
  };
  const run = async () => {
    const r = await forward.run();
    assert.equal(r.errors, 0, 'Đồng bộ lên CRM có dòng bị lỗi');
    return r;
  };
  const read = async () => (await sheets.readRows()).rows.map((r) => r.values);
  await write([{ Name: `KIỂM THỬ ${stamp} dữ liệu ban đầu`, Email: email, Phone: phone, Status: 'Mới' }]);
  let r = await run();
  assert.equal(r.created, 1);
  let rows = await read();
  const id = rows[0].ID;
  report.leadId = id;
  save();
  record('tao_ban_ghi_kiem_thu', { created: r.created, leadId: id });
  rows.push({ Name: `KIỂM THỬ ${stamp} trùng email`, Email: email, Status: 'Mới' });
  await write(rows);
  r = await run();
  assert.equal(r.created, 0);
  assert.equal(r.updated, 1);
  rows = await read();
  assert.equal(rows[1].ID, id);
  record('trung_email', { created: r.created, updated: r.updated, sameId: true });
  rows.push({ Name: `KIỂM THỬ ${stamp} trùng điện thoại`, Phone: phone, Status: 'Mới' });
  await write(rows);
  r = await run();
  assert.equal(r.created, 0);
  assert.equal(r.updated, 1);
  rows = await read();
  assert.equal(rows[2].ID, id);
  record('trung_dien_thoai', { created: r.created, updated: r.updated, sameId: true });
  for (let i = 0; i < rows.length; i++) rows[i].Name = `KIỂM THỬ ${stamp} dòng ${i}`;
  await write(rows);
  const before = writes;
  r = await run();
  assert.equal(r.updated, 3);
  assert.equal(writes - before, 3);
  assert.equal((await bitrix.call('crm.lead.get', { id })).TITLE, rows[2].Name);
  record('thu_tu_nhieu_dong_cung_ma', { updated: r.updated, batches: writes - before, lastRowWins: true });
  const idle = writes;
  r = await run();
  assert.equal(r.created, 0);
  assert.equal(r.updated, 0);
  assert.equal(r.skipped, 3);
  assert.equal(writes, idle);
  record('khong_doi_khong_ghi_lai', { skipped: r.skipped, crmWriteCalls: writes - idle });
  const rev = await reverse.run(id);
  assert.equal(rev.errors, 0);
  assert.equal(rev.updated, 3);
  rows = await read();
  assert.ok(rows.every((x) => x.Name === rows[2].Name));
  record('dong_bo_nguoc_tat_ca_dong_da_lien_ket', { updated: rev.updated });
  // Dùng một dòng do bài kiểm thử tạo để kiểm tra quy tắc ưu tiên độc lập với thứ tự nhiều dòng cùng Lead.
  await write([rows[0]]);
  cfg.set('SYNC_DIRECTION', 'both');
  process.env.SYNC_DIRECTION = 'both';
  for (const strategy of ['bitrix_wins', 'sheet_wins']) {
    cfg.set('CONFLICT_RESOLUTION_STRATEGY', strategy);
    process.env.CONFLICT_RESOLUTION_STRATEGY = strategy;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const local = `KIỂM THỬ ${stamp} tại bảng tính ${strategy}`;
    const remote = `KIỂM THỬ ${stamp} tại Bitrix ${strategy}`;
    await patch(2, { Name: local });
    await bitrix.call('crm.lead.update', { id, fields: { TITLE: remote } }, 0);
    const rr = await reverse.run(id);
    assert.equal(rr.errors, 0);
    assert.equal(rr.conflicts, 1);
    r = await run();
    const expected = strategy === 'bitrix_wins' ? remote : local;
    assert.equal((await read())[0].Name, expected);
    assert.equal((await bitrix.call('crm.lead.get', { id })).TITLE, expected);
    record(`xung_dot_${strategy}`, { conflicts: rr.conflicts, winner: strategy });
    const count = writes;
    r = await run();
    assert.equal(r.updated, 0);
    assert.equal(writes, count);
    record(`lap_lai_${strategy}`, { skipped: r.skipped, crmWriteCalls: 0 });
  }
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ hoanTat: true, tab, leadId: id, report: `${dir}/result.json` }));
}
main().catch((error) => {
  report.failed = {
    name: error.name,
    message:
      error.name === 'AssertionError'
        ? error.message
        : 'Lỗi API hoặc thiết lập; hãy kiểm tra thông tin xác thực và quyền truy cập tại máy chạy kiểm thử',
  };
  save();
  console.log(JSON.stringify({ thatBai: report.failed, tab, leadId: report.leadId }));
  process.exitCode = 1;
});
