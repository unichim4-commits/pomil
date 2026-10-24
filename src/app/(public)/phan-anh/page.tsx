import type { Metadata } from "next";
import { getSettings } from "@/modules/settings/service";
import { COMPLAINT_INTRO } from "@/modules/quality/copy";
import { ComplaintForm } from "./complaint-form";

export const metadata: Metadata = { title: "Báo vấn đề với sản phẩm" };

export default async function ComplaintPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const [{ lot }, settings] = await Promise.all([searchParams, getSettings()]);
  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
      <p className="eyebrow text-rind">Phản ánh</p>
      <h1 className="display mt-4 text-4xl">Báo vấn đề với sản phẩm</h1>
      <p className="mt-4 text-ink-soft">{COMPLAINT_INTRO}</p>
      <div className="mt-8">
        <ComplaintForm lotNo={lot ?? null} zalo={settings.zalo} hotline={settings.hotline} />
      </div>
    </div>
  );
}
