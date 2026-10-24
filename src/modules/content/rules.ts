// Bộ lọc câu công dụng (T-1). Mỹ phẩm không được quảng cáo như thuốc, và Pomil không hứa mọc tóc.
// Câu phủ định ("Không làm mọc tóc") và câu hỏi ("Bưởi có làm mọc tóc không?") vẫn được dùng.

export const BANNED_CLAIMS: readonly string[] = [
  "mọc tóc",
  "kích thích mọc",
  "tóc mọc",
  "hết rụng",
  "giảm rụng",
  "ngăn rụng",
  "chống rụng",
  "trị rụng",
  "trị gàu",
  "trị nấm",
  "trị viêm",
  "điều trị",
  "đặc trị",
  "trị liệu",
  "chữa",
  "phục hồi nang tóc",
  "kích thích nang tóc",
];

export type ClaimViolation = { phrase: string; sentence: string };

const NEGATION_RE = /(^|[^\p{L}])(không|chưa|chẳng|đừng)([^\p{L}]|$)/u;

export function checkClaims(text: string): ClaimViolation[] {
  const normalized = text.normalize("NFC");
  const violations: ClaimViolation[] = [];
  // Tách câu theo dấu chấm, chấm than, chấm hỏi, xuống dòng; giữ dấu cuối câu để nhận câu hỏi.
  const sentences = normalized.match(/[^.!?\n]+[.!?]?/g) ?? [];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const lower = sentence.toLowerCase();
    const isQuestion = sentence.endsWith("?");

    for (const phrase of BANNED_CLAIMS) {
      let from = 0;
      while (true) {
        const idx = lower.indexOf(phrase, from);
        if (idx === -1) break;
        from = idx + phrase.length;
        if (!isWholeWords(lower, idx, phrase.length)) continue;
        const before = lower.slice(0, idx);
        if (isQuestion || NEGATION_RE.test(before)) continue;
        if (!violations.some((v) => v.sentence === sentence && v.phrase === phrase)) violations.push({ phrase, sentence });
      }
    }
  }
  return violations;
}

function isWholeWords(text: string, idx: number, length: number): boolean {
  const prev = text[idx - 1];
  const next = text[idx + length];
  const isLetter = (c: string | undefined) => !!c && /\p{L}/u.test(c);
  return !isLetter(prev) && !isLetter(next);
}

export function describeViolations(violations: ClaimViolation[]): string {
  return violations.map((v) => `“${v.phrase}” trong câu: ${v.sentence}`).join("\n");
}
