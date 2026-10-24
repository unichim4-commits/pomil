export const VARIANT_COOKIE = "pomil_variant";
export type LandingVariant = "A" | "B";

export function readVariant(raw: string | undefined): LandingVariant {
  return raw === "B" ? "B" : "A";
}
