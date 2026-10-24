"use client";

import { useEffect, useRef } from "react";
import { useFormAction } from "@/components/use-form-action";
import type { ActionResult } from "../_lib/result";

// Form quản trị dùng chung: gửi Server Action, giữ chữ đã nhập, hiện kết quả ngay dưới nút.
export function ActionForm({
  action,
  children,
  submitLabel = "Lưu",
  pendingLabel = "Đang lưu…",
  className = "space-y-4",
  confirm,
  submitClassName = "btn btn-primary",
  resetOnSuccess = false,
  inline = false,
  noValidate = false,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  confirm?: string;
  submitClassName?: string;
  resetOnSuccess?: boolean;
  inline?: boolean;
  // Bỏ bóng báo lỗi của trình duyệt (lệch chỗ với nút ẩn trên iPhone), để máy chủ báo câu tiếng Việt.
  noValidate?: boolean;
}) {
  const [state, onSubmit, pending, ready] = useFormAction<ActionResult>(action, { status: "idle" });
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.status === "ok") ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      method="post"
      ref={ref}
      className={className}
      noValidate={noValidate}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
    >
      {children}
      <div className={inline ? "inline-flex items-center gap-3" : "flex flex-wrap items-center gap-3"}>
        <button type="submit" disabled={pending || !ready} className={submitClassName}>
          {pending ? pendingLabel : submitLabel}
        </button>
        <span aria-live="polite" className="text-sm">
          {state.status === "ok" && <span className="text-ok">{state.message}</span>}
          {state.status === "error" && <span className="whitespace-pre-line text-danger">{state.message}</span>}
        </span>
      </div>
    </form>
  );
}
