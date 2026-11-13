// Dữ liệu chạy thử cho 5 phân hệ ERP (00-tong-quan.md mục 11.2), chỉ chế độ demo, gọi sau dữ liệu demo cũ.
// Ràng buộc: không thêm/sửa products, lots, orders, order_items, customers; không đổi products.stock;
// Tonic giữ track_inventory = false. Mọi tên, số là giả định (ghi "(giả định)" ở tên hoặc ghi chú).
// Chạy nhiều lần được: đã có NCC-001 thì bỏ qua cả bộ.
//
// Tồn kho, IQC, công nợ đi qua hàm dùng chung (postReceipt, decideInspection, completeRun…) để số dư,
// thẻ kho, phiếu kiểm và công nợ khớp nhau như khi người dùng thao tác. Các hàm đó nạp bằng import động:
// chúng kéo theo "server-only", chỉ chạy được trong Next (PGlite chạy thử) hoặc vitest.
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Tx } from "./client";
import * as schema from "./schema";

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const G = " (giả định)";
const NOTE = "Dữ liệu chạy thử (giả định), sửa hoặc ngừng dùng khi có số thật.";

// Người thao tác hệ thống: không gắn nhân viên (cột người làm để trống), quyền chủ để qua các bước kiểm quyền
const SYSTEM = { id: null as unknown as string, role: "owner" as const };

function vnToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function monthRange(today: string): { start: string; end: string } {
  const start = `${today.slice(0, 7)}-01`;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { start, end: d.toISOString().slice(0, 10) };
}

// Mã cố định (NCC-001, NL-010…) không qua nextDocCode: đẩy bộ đếm lên để mã tự sinh sau này không trùng
async function bumpSequence(tx: Tx, key: string, value: number) {
  await tx
    .insert(schema.docSequences)
    .values({ key, lastValue: value })
    .onConflictDoUpdate({ target: schema.docSequences.key, set: { lastValue: sql`greatest(${schema.docSequences.lastValue}, ${value})`, updatedAt: new Date() } });
}

const L = 1_000_000; // 1 l = 1.000.000 ul
const KG = 1_000_000; // 1 kg = 1.000.000 mg

// Trong vitest mặc định bỏ qua: test của từng phân hệ dựng dữ liệu riêng trên DB mẫu và giả định chưa có
// NCC, phiếu, voucher… Test muốn có bộ dữ liệu này đặt SEED_ERP_DEMO=1 trước khi gọi getDb().
export function erpDemoEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.SEED_ERP_DEMO === "1") return true;
  if (env.SEED_ERP_DEMO === "0") return false;
  return !env.VITEST;
}

export async function seedErpDemo(db: AnyDb): Promise<void> {
  if (!erpDemoEnabled()) return;
  const tx = db as unknown as Tx;
  const [already] = await tx.select({ id: schema.suppliers.id }).from(schema.suppliers).where(eq(schema.suppliers.code, "NCC-001")).limit(1);
  if (already) return;

  const [{ postReceipt }, { decideInspection, saveInspectionResults }, { createRun, issuePeel, completeRun }, { createPlan }, { createOrder, planOrder }] = await Promise.all([
    import("@/modules/inventory/ledger"),
    import("@/modules/qms/decisions"),
    import("@/modules/production/extraction"),
    import("@/modules/production/plans"),
    import("@/modules/production/orders"),
  ]);

  const today = vnToday();
  const whRows = await tx.select({ id: schema.warehouses.id, code: schema.warehouses.code }).from(schema.warehouses);
  const wh = new Map(whRows.map((w) => [w.code, w.id]));
  const whId = (code: string) => {
    const id = wh.get(code);
    if (!id) throw new Error(`Thiếu kho ${code}: chạy seedErpMasterData trước`);
    return id;
  };
  const [tonic] = await tx.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.code, "PST")).limit(1);

  // ---- Nhà cung cấp
  const supplierDefs: (typeof schema.suppliers.$inferInsert)[] = [
    { code: "NCC-001", name: `Vườn bưởi mẫu${G}`, kind: "farm", paymentTermsDays: 0, qualified: true, note: NOTE },
    { code: "NCC-002", name: `Nhà máy gia công mẫu${G}`, kind: "factory", paymentTermsDays: 30, qualified: true, note: NOTE },
    { code: "NCC-003", name: `Bao bì mẫu${G}`, kind: "packaging", paymentTermsDays: 15, qualified: true, note: NOTE },
    { code: "NCC-004", name: `Nguyên liệu mẫu${G}`, kind: "material", paymentTermsDays: 0, qualified: true, note: NOTE },
  ];
  const sup = new Map<string, string>();
  for (const s of supplierDefs) {
    const [row] = await tx.insert(schema.suppliers).values(s).returning({ id: schema.suppliers.id });
    sup.set(s.code, row!.id);
  }
  await bumpSequence(tx, "NCC", 4);

  // ---- Hàng hóa
  type ItemDef = typeof schema.inventoryItems.$inferInsert;
  const raw = (code: string, name: string, extra: Partial<ItemDef>): ItemDef => ({
    code,
    name,
    kind: "raw_material",
    baseUom: "ul",
    displayUom: "ml",
    purchaseUom: "l",
    defaultSupplierId: sup.get("NCC-004"),
    defaultWarehouseId: whId("RAW"),
    note: NOTE,
    ...extra,
  });
  const pkg = (code: string, name: string, displayUom: string, price: number, extra: Partial<ItemDef> = {}): ItemDef => ({
    code,
    name,
    kind: "packaging",
    baseUom: "pcs",
    displayUom,
    purchaseUom: "cái",
    refUnitPrice: price,
    defaultSupplierId: sup.get("NCC-003"),
    defaultWarehouseId: whId("PKG"),
    groupName: "Bao bì Tonic",
    note: NOTE,
    ...extra,
  });
  const itemDefs: ItemDef[] = [
    raw("NL-001", `Nước tinh khiết${G}`, { densityMgPerMl: 1000, groupName: "Nền", refUnitPrice: 1_000 }),
    raw("NL-002", `Thành phần dưỡng tóc mẫu, dạng lỏng${G}`, { groupName: "Hoạt chất", refUnitPrice: 300_000 }),
    raw("NL-003", `Thành phần khác mẫu, dạng lỏng${G}`, { groupName: "Hoạt chất", refUnitPrice: 300_000 }),
    raw("NL-010", `Vỏ bưởi da xanh tươi${G}`, {
      baseUom: "mg",
      displayUom: "kg",
      purchaseUom: "kg",
      shelfLifeDays: 3,
      // Vỏ tươi nhận và chưng ngay: kiểm cảm quan lúc nhận, không lập phiếu IQC (giả định)
      requiresIqc: false,
      defaultSupplierId: sup.get("NCC-001"),
      groupName: "Vỏ bưởi",
      refUnitPrice: 4_000,
      storageCondition: "Nơi thoáng mát, chưng trong 3 ngày",
    }),
    {
      code: "TD-001",
      name: `Tinh dầu vỏ bưởi${G}`,
      kind: "extract",
      baseUom: "ul",
      displayUom: "ml",
      purchaseUom: "l",
      densityMgPerMl: 850,
      refUnitPrice: 2_000_000,
      defaultSupplierId: sup.get("NCC-004"),
      defaultWarehouseId: whId("EXT"),
      groupName: "Tinh dầu",
      storageCondition: "Chai thủy tinh tối màu, tránh nắng",
      note: NOTE,
    },
    {
      code: "TD-002",
      name: `Dịch chiết vỏ bưởi${G}`,
      kind: "extract",
      baseUom: "ul",
      displayUom: "ml",
      purchaseUom: "l",
      refUnitPrice: 100_000,
      defaultSupplierId: sup.get("NCC-004"),
      defaultWarehouseId: whId("EXT"),
      groupName: "Dịch chiết",
      note: NOTE,
    },
    pkg("BB-001", `Chai 100 ml${G}`, "chai", 6_000, { minStock: 100 }),
    pkg("BB-002", `Đầu xịt${G}`, "cái", 3_000),
    pkg("BB-003", `Nhãn${G}`, "nhãn", 1_500),
    pkg("BB-004", `Hộp${G}`, "hộp", 4_500),
  ];
  const item = new Map<string, string>();
  for (const d of itemDefs) {
    const [row] = await tx.insert(schema.inventoryItems).values(d).returning({ id: schema.inventoryItems.id });
    item.set(d.code, row!.id);
  }
  await bumpSequence(tx, "NL", 10);
  await bumpSequence(tx, "TD", 2);
  await bumpSequence(tx, "BB", 4);
  const it = (code: string) => item.get(code)!;

  // ---- Tiêu chuẩn chất lượng (trước phiếu nhập để phiếu IQC chép đúng chỉ tiêu). Không bịa chỉ tiêu số.
  const [tc1] = await tx
    .insert(schema.qcStandards)
    .values({ code: "TC-001", name: `Tinh dầu vỏ bưởi${G}`, appliesTo: "extract", itemId: it("TD-001"), status: "active", effectiveFrom: today, approvedAt: new Date(), note: NOTE })
    .returning({ id: schema.qcStandards.id });
  await tx.insert(schema.qcStandardParams).values([
    { standardId: tc1!.id, name: "Cảm quan (màu, mùi vỏ bưởi)", paramGroup: "sensory", kind: "pass_fail", sort: 0 },
    { standardId: tc1!.id, name: "COA kèm theo", paramGroup: "other", kind: "pass_fail", sort: 1 },
  ]);
  if (tonic) {
    const [tc2] = await tx
      .insert(schema.qcStandards)
      .values({ code: "TC-002", name: `Thành phẩm Tonic${G}`, appliesTo: "finished", productId: tonic.id, status: "active", effectiveFrom: today, approvedAt: new Date(), note: NOTE })
      .returning({ id: schema.qcStandards.id });
    await tx.insert(schema.qcStandardParams).values([
      { standardId: tc2!.id, name: "Ngoại quan", paramGroup: "sensory", kind: "pass_fail", sort: 0 },
      { standardId: tc2!.id, name: "Bao bì, nhãn", paramGroup: "label", kind: "pass_fail", sort: 1 },
      { standardId: tc2!.id, name: "Vi sinh", paramGroup: "microbial", kind: "pass_fail", lotTestType: "microbial", sort: 2 },
      { standardId: tc2!.id, name: "Kim loại nặng", paramGroup: "heavy_metal", kind: "pass_fail", lotTestType: "heavy_metals", sort: 3 },
      // Để trống giới hạn: chủ dự án điền theo chuyên môn (không bịa số)
      { standardId: tc2!.id, name: "pH", paramGroup: "physicochemical", kind: "range", isCritical: false, method: "Điền theo chuyên môn", sort: 4 },
    ]);
  }
  await bumpSequence(tx, "TC", 2);

  // ---- Phiếu nhập mua đã ghi sổ (công nợ phải trả, phiếu IQC tạo trong postReceipt)
  const tinhDau = await postReceipt(
    tx,
    {
      kind: "purchase",
      warehouseId: whId("EXT"),
      supplierId: sup.get("NCC-004"),
      receivedOn: today,
      note: `Nhập tinh dầu${G}`,
      lines: [{ itemId: it("TD-001"), qty: 1 * L, lineCost: 2_000_000 }],
    },
    null,
  );
  const baoBi = await postReceipt(
    tx,
    {
      kind: "purchase",
      warehouseId: whId("PKG"),
      supplierId: sup.get("NCC-003"),
      receivedOn: today,
      note: `Nhập bao bì${G}`,
      lines: [
        { itemId: it("BB-001"), qty: 300, lineCost: 300 * 6_000 },
        { itemId: it("BB-002"), qty: 300, lineCost: 300 * 3_000 },
        { itemId: it("BB-003"), qty: 300, lineCost: 300 * 1_500 },
        { itemId: it("BB-004"), qty: 300, lineCost: 300 * 4_500 },
      ],
    },
    null,
  );
  // Nguyên liệu ở kho RAW, dịch chiết ở kho EXT: hai phiếu cùng nhà cung cấp
  const nguyenLieu = await postReceipt(
    tx,
    {
      kind: "purchase",
      warehouseId: whId("RAW"),
      supplierId: sup.get("NCC-004"),
      receivedOn: today,
      note: `Nhập nguyên liệu, giá giả định`,
      lines: [
        { itemId: it("NL-001"), qty: 50 * L, lineCost: 50_000 },
        { itemId: it("NL-002"), qty: 5 * L, lineCost: 1_500_000 },
        { itemId: it("NL-003"), qty: 3 * L, lineCost: 900_000 },
      ],
    },
    null,
  );
  const dichChiet = await postReceipt(
    tx,
    {
      kind: "purchase",
      warehouseId: whId("EXT"),
      supplierId: sup.get("NCC-004"),
      receivedOn: today,
      note: `Nhập dịch chiết, giá giả định`,
      lines: [{ itemId: it("TD-002"), qty: 10 * L, lineCost: 1_000_000 }],
    },
    null,
  );

  // ---- IQC: đạt cho tinh dầu, bao bì, NL-001, NL-002, TD-002; NL-003 để chờ (thử cảnh báo "chờ kiểm")
  const nl003Lot = nguyenLieu.lines[2]!.stockLotId;
  const passLots = [...tinhDau.lines, ...baoBi.lines, ...nguyenLieu.lines, ...dichChiet.lines].map((l) => l.stockLotId).filter((id) => id !== nl003Lot);
  for (const stockLotId of passLots) {
    const [insp] = await tx
      .select({ id: schema.qcInspections.id })
      .from(schema.qcInspections)
      .where(and(eq(schema.qcInspections.stage, "iqc"), eq(schema.qcInspections.stockLotId, stockLotId), eq(schema.qcInspections.status, "pending")))
      .limit(1);
    if (!insp) continue;
    const results = await tx
      .select({ id: schema.qcInspectionResults.id, kind: schema.qcInspectionResults.kind })
      .from(schema.qcInspectionResults)
      .where(eq(schema.qcInspectionResults.inspectionId, insp.id));
    const entries = results.filter((r) => r.kind === "pass_fail").map((r) => ({ resultId: r.id, passFail: "pass" as const }));
    if (entries.length) await saveInspectionResults(tx, insp.id, { entries, note: `Kết quả giả định` }, SYSTEM);
    await decideInspection(tx, insp.id, { disposition: "accept", note: `Đạt${G}` }, SYSTEM);
  }

  // ---- Tồn đầu kỳ thành phẩm: lô PST-271101-01 có sẵn (đang cách ly), không sửa bảng lots
  const [pstLot] = await tx
    .select({ id: schema.lots.id, manufacturedOn: schema.lots.manufacturedOn })
    .from(schema.lots)
    .where(eq(schema.lots.lotNo, "PST-271101-01"))
    .limit(1);
  const [pstItem] = tonic ? await tx.select({ id: schema.inventoryItems.id }).from(schema.inventoryItems).where(eq(schema.inventoryItems.productId, tonic.id)).limit(1) : [];
  if (pstLot && pstItem) {
    // Ngày nhập không được trước ngày sản xuất của lô mẫu (lô mẫu ghi ngày tương lai)
    const receivedOn = pstLot.manufacturedOn && pstLot.manufacturedOn > today ? pstLot.manufacturedOn : today;
    await postReceipt(
      tx,
      {
        kind: "opening",
        warehouseId: whId("FG"),
        receivedOn,
        paymentMode: "none",
        note: `Tồn đầu kỳ lô mẫu${G}`,
        lines: [{ itemId: pstItem.id, qty: 300, lineCost: 19_500_000, productLotId: pstLot.id }],
      },
      null,
    );
  }

  // ---- Công thức FORM-001 phiên bản 1 đã duyệt
  const [formula] = await tx
    .insert(schema.formulas)
    .values({ code: "FORM-001", name: `Scalp Tonic${G}`, productId: tonic?.id ?? null, note: NOTE })
    .returning({ id: schema.formulas.id });
  const [version] = await tx
    .insert(schema.formulaVersions)
    .values({
      formulaId: formula!.id,
      version: 1,
      label: tonic ? "PST-v1" : "FORM-001-v1",
      status: "approved",
      batchSize: 100 * L,
      batchUom: "ul",
      expectedYieldBp: 9800,
      processNote: `Quy trình giả định, điền theo nhà máy`,
      approvedAt: new Date(),
    })
    .returning({ id: schema.formulaVersions.id });
  await tx.insert(schema.formulaLines).values([
    { formulaVersionId: version!.id, itemId: it("NL-001"), ppm: 700_000, isBalance: true, sort: 0 },
    { formulaVersionId: version!.id, itemId: it("TD-002"), ppm: 150_000, sort: 1 },
    { formulaVersionId: version!.id, itemId: it("NL-002"), ppm: 100_000, sort: 2 },
    { formulaVersionId: version!.id, itemId: it("NL-003"), ppm: 50_000, sort: 3 },
  ]);
  await tx.insert(schema.formulaPackaging).values(["BB-001", "BB-002", "BB-003", "BB-004"].map((c, i) => ({ formulaVersionId: version!.id, itemId: it(c), qtyPerUnit: 1, sort: i })));
  await bumpSequence(tx, "FORM", 1);

  // ---- Kế hoạch tháng (nháp) và lệnh gia công đã lên kế hoạch
  if (tonic) {
    const m = monthRange(today);
    const plan = await createPlan(tx, SYSTEM, { period: "month", periodStart: m.start, periodEnd: m.end, note: `Kế hoạch giả định` });
    // Thêm dòng trực tiếp: addPlanLine đòi dung tích sản phẩm, seed không được sửa products
    const [planLine] = await tx
      .insert(schema.productionPlanLines)
      .values({ planId: plan.id, productId: tonic.id, formulaVersionId: version!.id, targetUnits: 300, note: G.trim() })
      .returning({ id: schema.productionPlanLines.id });
    const order = await createOrder(tx, SYSTEM, {
      kind: "outsourced",
      productId: tonic.id,
      formulaVersionId: version!.id,
      formulaLabel: null,
      supplierId: sup.get("NCC-002")!,
      outsourcingUnitPrice: 40_000,
      plannedUnits: 300,
      // Sản phẩm chưa ghi dung tích (không sửa products): ghi sẵn lượng mẻ 300 × 100 ml chia hiệu suất 98%
      plannedBulk: Math.ceil((300 * 100_000) / 0.98),
      batchCount: 1,
      planLineId: planLine!.id,
      note: `Lệnh gia công giả định`,
    });
    await planOrder(tx, SYSTEM, order.id);
  }

  // ---- Mẻ chiết thuê lò: xuất 50 kg vỏ, ra 400 ml tinh dầu, lô EX chờ IPQC
  await postReceipt(
    tx,
    {
      kind: "purchase",
      warehouseId: whId("RAW"),
      supplierId: sup.get("NCC-001"),
      receivedOn: today,
      note: `Nhập vỏ bưởi tươi${G}`,
      lines: [{ itemId: it("NL-010"), qty: 50 * KG, lineCost: 200_000, qcRequired: false }],
    },
    null,
  );
  const run = await createRun(tx, SYSTEM, {
    kind: "outsourced",
    pomeloVariety: "Bưởi da xanh",
    sourceSupplierId: sup.get("NCC-001")!,
    harvestOn: today,
    peelCondition: "Tươi",
    method: "steam_distillation",
    equipment: "",
    operatorName: "",
    serviceSupplierId: sup.get("NCC-001")!,
    serviceFee: 500_000,
    otherCost: 0,
    params: [],
    outputItemId: it("TD-001"),
    note: `Mẻ chiết giả định`,
  });
  await issuePeel(tx, SYSTEM, run.id, { itemId: it("NL-010"), qty: 50 * KG });
  await completeRun(tx, SYSTEM, run.id, { outputQty: 400_000 }, today);

  // ---- Bán hàng: bảng giá đại lý, đại lý, voucher
  const [dlList] = await tx
    .insert(schema.priceLists)
    .values({ code: "BG-DL", name: `Bảng giá đại lý${G}`, kind: "dealer", channelCode: "DL", note: NOTE })
    .returning({ id: schema.priceLists.id });
  if (tonic) await tx.insert(schema.priceListItems).values({ priceListId: dlList!.id, productId: tonic.id, unitPrice: 175_000 });
  await tx.insert(schema.dealers).values({
    code: "DL-001",
    name: `Salon mẫu${G}`,
    priceListId: dlList!.id,
    discountBp: 0,
    commissionBp: 500,
    creditLimit: 5_000_000,
    paymentTermsDays: 15,
    note: NOTE,
  });
  await bumpSequence(tx, "DL", 1);
  const [voucher] = await tx.select({ id: schema.vouchers.id }).from(schema.vouchers).where(eq(schema.vouchers.code, "THU10")).limit(1);
  if (!voucher) await tx.insert(schema.vouchers).values({ code: "THU10", kind: "percent", value: 1000, maxDiscount: 30_000 });

  // ---- Tài chính: số dư đầu, ngân sách tháng
  await tx.update(schema.cashAccounts).set({ openingBalance: 5_000_000 }).where(eq(schema.cashAccounts.code, "TM"));
  await tx.update(schema.cashAccounts).set({ openingBalance: 20_000_000 }).where(eq(schema.cashAccounts.code, "NH"));
  const m = monthRange(today);
  const [budgetExists] = await tx
    .select({ id: schema.budgets.id })
    .from(schema.budgets)
    .where(and(eq(schema.budgets.period, "month"), eq(schema.budgets.periodStart, m.start)))
    .limit(1);
  if (!budgetExists) {
    const [budget] = await tx
      .insert(schema.budgets)
      .values({ name: `Ngân sách tháng ${m.start.slice(5, 7)}/${m.start.slice(0, 4)}${G}`, period: "month", periodStart: m.start, status: "active", note: NOTE })
      .returning({ id: schema.budgets.id });
    await tx.insert(schema.budgetLines).values([
      { budgetId: budget!.id, budgetGroup: "materials", categoryId: null, amount: 3_000_000 },
      { budgetId: budget!.id, budgetGroup: "marketing", categoryId: null, amount: 2_000_000 },
    ]);
  }
}
