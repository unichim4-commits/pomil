import { describe, expect, it } from "vitest";
import { maskPhone, normalizeVnPhone } from "@/lib/phone";

describe("normalizeVnPhone", () => {
  it.each([
    ["0901234567", "84901234567"],
    ["090 123 4567", "84901234567"],
    ["+84 90 123 4567", "84901234567"],
    ["84901234567", "84901234567"],
    ["0387.654.321", "84387654321"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "0201234567", "09012345678", "abc"])("rejects %s", (input) => {
    expect(normalizeVnPhone(input)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("keeps prefix and last 3 digits", () => {
    expect(maskPhone("84901234567")).toBe("84901***567");
  });
});

import { toLocalMobile, toTelNumber } from "@/lib/phone";

describe("toLocalMobile / toTelNumber", () => {
  it("normalizes mobile to 0xxxxxxxxx", () => {
    for (const v of ["0911222333", "+84911222333", "84 911 222 333", "0911.222.333", "0911-222-333", " 091 1222 333 "]) {
      expect(toLocalMobile(v)).toBe("0911222333");
      expect(toTelNumber(v)).toBe("0911222333");
    }
  });
  it("rejects invalid mobile", () => {
    for (const v of ["", "abc", "12345", "0211222333", "09112223", "0911222333444"]) expect(toLocalMobile(v)).toBeNull();
  });
  it("accepts hotline and landline for tel", () => {
    expect(toTelNumber("1900 1234")).toBe("19001234");
    expect(toTelNumber("1800.6789")).toBe("18006789");
    expect(toTelNumber("028 3822 1234")).toBe("02838221234");
    expect(toTelNumber("+84 28 3822 1234")).toBe("02838221234");
    expect(toTelNumber("12")).toBeNull();
    expect(toTelNumber("1900abcd")).toBeNull();
  });
});
