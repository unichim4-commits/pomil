import { describe, expect, it } from "vitest";
import { checkClaims } from "@/modules/content/rules";
import { launchNoteToShow } from "@/modules/settings/rules";

// T-8 / SA-3: "Dự kiến mở bán" chỉ hiện khi cửa hàng đang tắt nhận đơn.
describe("launchNoteToShow", () => {
  const note = "Dự kiến mở bán tháng 11/2027.";
  it("shows the note only while sales are closed", () => {
    expect(launchNoteToShow({ salesOpen: false, launchNote: note })).toBe(note);
    expect(launchNoteToShow({ salesOpen: true, launchNote: note })).toBeNull();
  });
  it("hides empty or blank notes", () => {
    expect(launchNoteToShow({ salesOpen: false, launchNote: "" })).toBeNull();
    expect(launchNoteToShow({ salesOpen: false, launchNote: "   " })).toBeNull();
  });
  it("trims the note", () => {
    expect(launchNoteToShow({ salesOpen: false, launchNote: `  ${note} ` })).toBe(note);
  });
  it("settings hint passes the claim filter", () => {
    expect(checkClaims("Viết cả câu khách sẽ đọc, ví dụ: Dự kiến mở bán tháng 11/2027. Để trống thì ẩn. Tự ẩn khi bật nhận đơn.")).toEqual([]);
  });
});
