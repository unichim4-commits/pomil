"use client";

import { useActionState } from "react";
import { zaloUsersAction, type ZaloUsersState } from "./actions";

export function ZaloUsers() {
  const [state, action, pending] = useActionState<ZaloUsersState>(zaloUsersAction, { status: "idle" });
  return (
    <div className="space-y-3">
      <form action={action}>
        <button disabled={pending} className="btn btn-outline">
          {pending ? "Đang hỏi Zalo…" : "Xem người vừa nhắn OA (30 ngày)"}
        </button>
      </form>
      {state.status === "error" && <p className="text-sm text-danger">{state.message}</p>}
      {state.status === "ok" &&
        (state.users.length === 0 ? (
          <p className="text-sm text-ink-soft">Chưa có ai nhắn OA trong 30 ngày. Dùng Zalo của bạn nhắn một tin bất kỳ vào OA rồi bấm lại.</p>
        ) : (
          <ul className="divide-y divide-line border border-line text-sm">
            {state.users.map((u) => (
              <li key={u.userId} className="flex justify-between gap-4 px-3 py-2">
                <span>{u.name || "(không rõ tên)"}</span>
                <span className="select-all font-mono">{u.userId}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
