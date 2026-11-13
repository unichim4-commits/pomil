// Màu nhãn trạng thái đổi trả
export function returnTone(s: string): "neutral" | "amber" | "green" | "red" | "dark" {
  if (s === "completed") return "green";
  if (s === "rejected" || s === "cancelled") return "neutral";
  if (s === "received") return "dark";
  return "amber";
}
