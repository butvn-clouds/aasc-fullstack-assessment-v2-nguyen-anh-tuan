/** Không trả URL webhook, token, stack trace hoặc payload nhà cung cấp về trình duyệt. */
export function publicError(error: unknown): { code: string; message: string } {
  const e = error as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { error?: unknown } };
  };
  const raw = String(e?.code ?? e?.response?.data?.error ?? e?.message ?? '');
  const known: Record<string, string> = {
    SYNC_LOCKED:
      'Đang có tiến trình đồng bộ khác (server, CLI hoặc container) chạy trên cùng dữ liệu. Chờ nó hoàn tất rồi chạy lại; không cần xóa khóa trừ khi chắc chắn tiến trình đó đã chết.',
    CRM_SIMPLE_MODE:
      'Portal đang dùng Simple CRM, tự chuyển Lead thành Deal. Chuyển sang Classic CRM để đồng bộ Lead; ứng dụng chưa ghi dữ liệu trong lượt này.',
    CRM_MODE_UNKNOWN:
      'Không xác định được chế độ CRM. Kiểm tra quyền crm.settings.mode.get trước khi đồng bộ.',
    RECOVERY_UNCERTAIN:
      'Lần tạo trước chưa rõ kết quả. Đối chiếu CRM, điền Lead ID đúng vào Sheet rồi chạy lại; hệ thống đã chặn tạo trùng.',
    RECOVERY_ROW_CHANGED:
      'Dòng đang chờ phục hồi đã thay đổi hoặc có ID khác. Khôi phục đúng vị trí/dữ liệu và đối chiếu Lead ID trước khi chạy lại.',
    RECOVERY_STORAGE_ERROR:
      'Không đọc/ghi được data/create-journal.json. Kiểm tra quyền ghi, dung lượng và bản sao lưu; không xóa nhật ký để thử lại.',
    FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN:
      'Bitrix24 không cho phép API trên gói hiện tại. Kiểm tra gói và quyền REST của portal.',
    invalid_client:
      'Google từ chối OAuth Client ID/Secret. Kiểm tra hai giá trị thuộc cùng OAuth client.',
    invalid_grant: 'Quyền OAuth Google đã hết hiệu lực. Cấp lại refresh token.',
    QUERY_LIMIT_EXCEEDED:
      'Bitrix24 giới hạn tần suất. Chờ rồi thử lại; không chạy nhiều job cùng lúc.',
    INVALID_CREDENTIALS: 'Webhook Bitrix24 không hợp lệ hoặc đã bị thu hồi.',
    NO_AUTH_FOUND: 'Bitrix24 không nhận được thông tin xác thực hợp lệ.',
  };
  for (const [code, message] of Object.entries(known))
    if (raw.includes(code)) return { code, message };
  if (e?.response?.status === 403)
    return {
      code: 'UPSTREAM_FORBIDDEN',
      message:
        'Dịch vụ từ chối quyền truy cập. Kiểm tra quyền Sheet hoặc CRM của tài khoản đang dùng.',
    };
  if (/timeout|ETIMEDOUT|ECONN|fetch failed/i.test(raw))
    return {
      code: 'UPSTREAM_TIMEOUT',
      message:
        'Kết nối dịch vụ bị gián đoạn. Nếu lỗi xảy ra lúc đang ghi vào CRM, hãy đối chiếu lead trước khi chạy lại (lần ghi có thể đã được xử lý); nếu chỉ lỗi khi đọc dữ liệu thì có thể chạy lại ngay.',
    };
  return {
    code: 'SYNC_FAILED',
    message:
      'Không hoàn tất đồng bộ. Kiểm tra cấu hình, quyền truy cập và log máy chủ; không chạy lại liên tục.',
  };
}
