// Tên thương hiệu viết bằng chữ thường của bộ chữ chính (Be Vietnam Pro nhẹ, giãn chữ), không có biểu tượng.
export function Wordmark({ className = "text-xl", title = "Pomil" }: { className?: string; title?: string }) {
  return (
    <span className={`inline-block font-light uppercase leading-none tracking-[0.32em] ${className}`} role="img" aria-label={title}>
      POMIL
    </span>
  );
}

// Mặt cắt quả bưởi, nét 1px. Các múi xoay rất chậm, vòng ngoài thở nhẹ.
export function CrossSection({ className = "h-40 w-40", animated = true }: { className?: string; animated?: boolean }) {
  const spokes = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return { x: 100 + 62 * Math.sin(a), y: 100 - 62 * Math.cos(a) };
  });
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <g className={animated ? "ring-pulse" : undefined}>
        <circle cx="100" cy="100" r="96" />
        <circle cx="100" cy="100" r="88" />
      </g>
      <g className={animated ? "spin-slow" : undefined}>
        <circle cx="100" cy="100" r="62" />
        {spokes.map((p, i) => (
          <line key={i} x1="100" y1="100" x2={p.x.toFixed(2)} y2={p.y.toFixed(2)} />
        ))}
      </g>
    </svg>
  );
}

// Bọt tinh dầu nhỏ nổi lên rồi tan, làm nền động. Vị trí cố định để không lệch giữa máy chủ và trình duyệt.
const BUBBLES = [
  { left: "6%", size: 10, t: 9, d: 0, dx: 14 },
  { left: "17%", size: 18, t: 12, d: 2.5, dx: -10 },
  { left: "29%", size: 8, t: 8, d: 5, dx: 8 },
  { left: "41%", size: 22, t: 14, d: 1, dx: 16 },
  { left: "53%", size: 12, t: 10, d: 6.5, dx: -14 },
  { left: "64%", size: 16, t: 11, d: 3.5, dx: 10 },
  { left: "76%", size: 9, t: 9, d: 7.5, dx: -8 },
  { left: "88%", size: 20, t: 13, d: 4, dx: -16 },
] as const;

export function Bubbles({ className = "text-rind/50" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{ left: b.left, width: b.size, height: b.size, ["--t" as string]: `${b.t}s`, ["--d" as string]: `${b.d}s`, ["--dx" as string]: `${b.dx}px` }}
        />
      ))}
    </div>
  );
}

const TONES = {
  graphite: { body: "#1e2420", shade: "#2e3631", ink: "#f3f0ea", sub: "#c9c4b8" },
  bone: { body: "#f1ede5", shade: "#dcd6ca", ink: "#1e2420", sub: "#4a514c" },
  rind: { body: "#6e7b5e", shade: "#5d6950", ink: "#f3f0ea", sub: "#dfe3d6" },
} as const;

export type BottleTone = keyof typeof TONES;

export function toneOf(value: string): BottleTone {
  return value === "bone" || value === "rind" ? value : "graphite";
}

// Chai xịt in một màu như trang bao bì. Dùng khi sản phẩm chưa có ảnh chụp.
export function Bottle({
  tone = "graphite",
  name,
  subtitle,
  size,
  className = "h-full w-auto",
}: {
  tone?: BottleTone;
  name: string;
  subtitle?: string;
  size?: string;
  className?: string;
}) {
  const t = TONES[tone];
  const id = `b-${tone}`;
  return (
    <svg viewBox="0 0 240 520" className={className} role="img" aria-label={`${name}${size ? `, ${size}` : ""}`}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" x2="1">
          <stop offset="0" stopColor={t.shade} />
          <stop offset="0.22" stopColor={t.body} />
          <stop offset="0.55" stopColor={t.body} />
          <stop offset="0.7" stopColor={t.shade} stopOpacity="0.6" />
          <stop offset="1" stopColor={t.body} />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="505" rx="104" ry="9" fill="#1e2420" opacity="0.16" className="shadow-breathe" />
      <g className="float">
      {/* Đầu xịt */}
      <rect x="92" y="8" width="56" height="64" rx="4" fill="#1e2420" />
      <rect x="146" y="22" width="16" height="10" rx="2" fill="#1e2420" />
      <rect x="80" y="70" width="80" height="78" rx="4" fill="#232a26" />
      {/* Thân chai */}
      <path d={`M20,190 Q20,160 60,156 L180,156 Q220,160 220,190 L220,488 Q220,500 208,500 L32,500 Q20,500 20,488 Z`} fill={`url(#${id}-g)`} />
      <text x="120" y="276" textAnchor="middle" fill={t.ink} fontSize="30" fontWeight="300" letterSpacing="9">
        POMIL
      </text>
      <text x="120" y="330" textAnchor="middle" fill={t.ink} fontSize="11.5" letterSpacing="2.8" fontWeight="500" style={{ textTransform: "uppercase" }}>
        {name.toUpperCase().slice(0, 24)}
      </text>
      {subtitle && (
        <text x="120" y="350" textAnchor="middle" fill={t.sub} fontSize="9.5">
          {subtitle.slice(0, 34)}
        </text>
      )}
      {size && (
        <text x="120" y="440" textAnchor="middle" fill={t.ink} fontSize="10" letterSpacing="2">
          {size}
        </text>
      )}
      <text x="120" y="478" textAnchor="middle" fill={t.sub} fontSize="8" letterSpacing="2.4">
        LÔ Nº ····
      </text>
      </g>
    </svg>
  );
}
