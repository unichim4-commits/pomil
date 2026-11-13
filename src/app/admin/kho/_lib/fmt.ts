import { formatQty, type BaseUom, type DisplayUom } from "@/modules/inventory/rules";

// Số lượng theo đơn vị hiển thị của hàng
export function q(qty: number, item: { baseUom: BaseUom; displayUom: string }): string {
  return formatQty(qty, item.baseUom, item.displayUom as DisplayUom);
}

// Số không kèm đơn vị, để điền sẵn vào ô nhập
export function qPlain(qty: number, item: { baseUom: BaseUom; displayUom: string }): string {
  return q(qty, item).replace(/ [^ ]+$/, "").replace(/\./g, "");
}

export function viDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
