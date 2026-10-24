// Lỗi nghiệp vụ có chủ ý: câu báo viết sẵn cho người dùng, guard() hiện nguyên câu.
// Mọi lỗi khác (lỗi DB, lỗi lập trình) chỉ hiện câu chung và ghi log đã lọc dữ liệu.
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
