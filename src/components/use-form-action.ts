"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";

// Gửi form qua Server Action nhưng giữ nguyên chữ đã nhập khi máy chủ báo lỗi.
// (Dùng <form action={fn}> thì React 19 tự xóa trắng form sau mỗi lần gửi.)
// `ready` = false cho tới khi trang chạy JavaScript: khóa nút gửi để trình duyệt không tự gửi
// form kiểu GET và đưa số điện thoại, địa chỉ lên thanh địa chỉ. Form nên đặt method="post".
export function useFormAction<S>(fn: (state: Awaited<S>, formData: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState(fn, initial);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };
  return [state, onSubmit, pending, ready] as const;
}
