import Link from "next/link";
import { displayPhone, formatDateTime, formatVnd } from "@/lib/format";
import { requireStaff } from "@/modules/auth/service";
import { listAllProducts } from "@/modules/catalog/service";
import { countByStage } from "@/modules/customers/admin";
import { ORDER_STATUS_LABEL } from "@/modules/orders/rules";
import { countOrdersByStatus, dashboardStats, recentOrders } from "@/modules/orders/service";
import { countOpenComplaints } from "@/modules/quality/admin";
import { countFailedNotifications } from "@/modules/notify/service";
import { getSeedMode, getSettings } from "@/modules/settings/service";
import { maskPhone } from "@/lib/phone";
import { can } from "@/modules/auth/rules";
import type { AdminAlert } from "@/modules/alerts";
import { getDb } from "@/db/client";
import { getAlerts as financeAlerts } from "@/modules/finance/alerts";
import { getAlerts as inventoryAlerts } from "@/modules/inventory/alerts";
import { refreshExpiredStock } from "@/modules/inventory/ledger";
import { getAlerts as productionAlerts } from "@/modules/production/alerts";
import { getAlerts as qmsAlerts } from "@/modules/qms/alerts";
import { getAlerts as salesAlerts } from "@/modules/sales/alerts";
import { Badge, Card, Empty, ORDER_TONE, PageHeader, Stat, Table } from "./_components/ui";

const LOW_STOCK = 20;

const ALERT_MODULE_LABEL: Record<AdminAlert["module"], string> = { kho: "Kho", "san-xuat": "Sản xuất", "chat-luong": "Chất lượng", "ban-hang": "Bán hàng", "tai-chinh": "Tài chính" };
const ALERT_TONE = { danger: "red", warn: "amber", info: "neutral" } as const;
const ALERT_ORDER = { danger: 0, warn: 1, info: 2 } as const;

// Cảnh báo 5 phân hệ (00-tong-quan mục 8.7): lỗi một phân hệ thì bỏ qua, không làm hỏng trang
async function collectAlerts(role: Parameters<typeof inventoryAlerts>[0]): Promise<AdminAlert[]> {
  const sources = [inventoryAlerts, productionAlerts, qmsAlerts, salesAlerts, financeAlerts];
  const results = await Promise.all(
    sources.map((fn) =>
      fn(role).catch((err: unknown) => {
        console.error("[admin] getAlerts lỗi", err);
        return [] as AdminAlert[];
      }),
    ),
  );
  return results.flat().sort((a, b) => ALERT_ORDER[a.level] - ALERT_ORDER[b.level]);
}

// R-KHO-27: lô hết hạn rời số bán được; hàm tự bỏ qua nếu vừa chạy trong 60 phút
async function refreshExpiry(): Promise<void> {
  try {
    await refreshExpiredStock(await getDb());
  } catch (err) {
    console.error("[admin] refreshExpiredStock lỗi", err);
  }
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ moi?: string }> }) {
  const [{ moi }, staff] = await Promise.all([searchParams, requireStaff()]);
  await refreshExpiry();
  const [alerts, stats, byStatus, stages, openComplaints, products, recent, settings, failedNotify, seedMode] = await Promise.all([
    collectAlerts(staff.role),
    dashboardStats(),
    countOrdersByStatus(),
    countByStage(),
    countOpenComplaints(),
    listAllProducts(),
    recentOrders(),
    getSettings(),
    countFailedNotifications(),
    getSeedMode(),
  ]);

  const toHandle = (byStatus.pending ?? 0) + (byStatus.confirmed ?? 0) + (byStatus.packing ?? 0);
  const buyers = (stages.first_buyer ?? 0) + (stages.repeat_buyer ?? 0) + (stages.ambassador ?? 0);
  const repeatRate = buyers > 0 ? Math.round(((stages.repeat_buyer ?? 0) / buyers) * 100) : 0;
  const lowStock = products.filter((p) => p.status === "active" && p.stock < LOW_STOCK);
  const showPhone = can(staff.role, "customers.view_phone");

  // 14 ngày gần nhất, điền 0 cho ngày không có đơn
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() + 7 * 3600 * 1000 - (13 - i) * 86400 * 1000);
    const key = d.toISOString().slice(0, 10);
    const found = stats.daily.find((x) => x.day === key);
    return { key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, revenue: found?.revenue ?? 0, orders: found?.orders ?? 0 };
  });
  const maxRevenue = Math.max(1, ...days.map((d) => d.revenue));

  return (
    <>
      <PageHeader title={`Chào ${staff.name || "bạn"}`} description="Tình hình cửa hàng hôm nay. Số tiền tính trên đơn chưa hủy, chưa hoàn." />

      {seedMode === "demo" && (
        <div className="mb-6 border border-danger/40 bg-danger/5 p-4 text-sm" role="status">
          Đang dùng dữ liệu mẫu: sản phẩm, tồn kho và lô chỉ để chạy thử, đang bật nhận đơn. Bản chạy thật nạp bằng <code>npm run db:seed</code> (tắt bán, tồn kho 0).
        </div>
      )}
      {moi && (
        <div className="mb-6 border border-rind/40 bg-rind/10 p-4 text-sm">
          Đã tạo tài khoản chủ cửa hàng. Việc nên làm tiếp: <Link href="/admin/tai-khoan" className="underline">bật xác thực 2 lớp</Link>,{" "}
          <Link href="/admin/cai-dat" className="underline">điền hotline và tài khoản ngân hàng</Link>, rồi{" "}
          <Link href="/admin/san-pham" className="underline">kiểm tra giá và tồn kho</Link>.
        </div>
      )}
      {!settings.salesOpen && (
        <div className="mb-6 border border-[#e3c98f] bg-[#f6ecd5] p-4 text-sm">
          Cửa hàng đang <strong>tạm ngừng nhận đơn</strong>: khách chỉ đăng ký giữ chỗ được. Bật lại trong <Link href="/admin/cai-dat" className="underline">Cài đặt</Link>.
        </div>
      )}

      {alerts.length > 0 && (
        <Card title="Cảnh báo vận hành" className="mb-6">
          <ul className="grid gap-2 sm:grid-cols-2">
            {alerts.map((a, i) => (
              <li key={`${a.module}-${i}`}>
                <Link href={a.href} className="flex min-h-11 items-center justify-between gap-3 border border-line bg-paper px-4 py-2 text-sm hover:border-graphite">
                  <span>
                    <span className="text-ink-soft">{ALERT_MODULE_LABEL[a.module]} · </span>
                    {a.text}
                  </span>
                  <Badge tone={ALERT_TONE[a.level]}>{a.count ?? "!"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Doanh thu hôm nay" value={formatVnd(stats.today.revenue)} hint={`${stats.today.orders} đơn`} />
        <Stat label="30 ngày qua" value={formatVnd(stats.last30.revenue)} hint={`${stats.last30.orders} đơn`} />
        <Stat label="Đơn cần xử lý" value={String(toHandle)} hint={`${byStatus.pending ?? 0} chờ xác nhận`} href="/admin/don-hang?status=pending" />
        <Stat label="Khách mua lại" value={`${stages.repeat_buyer ?? 0}`} hint={`${repeatRate}% trên ${buyers} khách đã mua · chỉ số chính`} href="/admin/khach-hang?stage=repeat_buyer" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Doanh thu 14 ngày">
          <div className="flex h-44 items-end gap-1.5" role="img" aria-label="Biểu đồ doanh thu 14 ngày gần nhất">
            {days.map((d, i) => (
              <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end">
                <div className="bar-grow w-full bg-rind/80 transition-colors group-hover:bg-graphite" style={{ height: `${Math.max(d.revenue > 0 ? 4 : 1, (d.revenue / maxRevenue) * 100)}%`, ["--d" as string]: `${300 + i * 45}ms` }} />
                <span className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap bg-graphite px-2 py-1 text-[0.7rem] text-bone group-hover:block">
                  {d.label}: {formatVnd(d.revenue)} · {d.orders} đơn
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[0.7rem] text-ink-soft">
            <span>{days[0]?.label}</span>
            <span>{days[days.length - 1]?.label}</span>
          </div>
        </Card>

        <Card title="Cần để ý">
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between">
              <Link href="/admin/phan-anh" className="inline-flex min-h-11 items-center hover:underline">
                Phản ánh đang mở
              </Link>
              <Badge tone={openComplaints > 0 ? "red" : "green"}>{openComplaints}</Badge>
            </li>
            <li className="flex justify-between">
              <Link href="/admin/khach-hang?stage=lead" className="inline-flex min-h-11 items-center hover:underline">
                Danh sách chờ
              </Link>
              <Badge>{stages.lead ?? 0}</Badge>
            </li>
            {failedNotify > 0 && can(staff.role, "settings.write") && (
              <li className="flex justify-between">
                <Link href="/admin/thong-bao" className="inline-flex min-h-11 items-center hover:underline">
                  Thông báo gửi lỗi
                </Link>
                <Badge tone="red">{failedNotify}</Badge>
              </li>
            )}
            {lowStock.map((p) => (
              <li key={p.id} className="flex justify-between">
                <Link href={`/admin/san-pham/${p.id}`} className="inline-flex min-h-11 items-center hover:underline">
                  Tồn kho thấp: {p.name}
                </Link>
                <Badge tone={p.stock === 0 ? "red" : "amber"}>{p.stock}</Badge>
              </li>
            ))}
            {lowStock.length === 0 && <li className="text-ink-soft">Không có sản phẩm nào sắp hết.</li>}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow text-[0.68rem]">Đơn mới nhất</h2>
          <Link href="/admin/don-hang" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            Tất cả đơn
          </Link>
        </div>
        {recent.length === 0 ? (
          <Empty>Chưa có đơn nào. Đơn đặt trên website sẽ hiện ở đây.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Khách</th>
                <th>Tổng</th>
                <th>Trạng thái</th>
                <th>Lúc đặt</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id} className="hover:bg-bone">
                  <td>
                    <Link href={`/admin/don-hang/${o.id}`} className="font-mono underline-offset-4 hover:underline">
                      {o.code}
                    </Link>
                  </td>
                  <td>
                    {o.recipientName}
                    <span className="block text-xs text-ink-soft">{showPhone ? displayPhone(o.phoneE164) : maskPhone(o.phoneE164)}</span>
                  </td>
                  <td className="tabular-nums">{formatVnd(o.total)}</td>
                  <td>
                    <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                  </td>
                  <td className="text-ink-soft">{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
