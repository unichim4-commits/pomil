// Logo và minh họa vẽ lại từ file SVG gốc trong thư mục logo/ (bộ nhận diện v2), đổi sang currentColor.

export function Wordmark({ className = "h-5 w-auto", title = "Pomil" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 -12.95 454.2 114.55" className={className} role="img" aria-label={title}>
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter" strokeMiterlimit="10">
        <path d="M2.5,100 V2.5 H24.5 A25,25 0 0 1 24.5,52.5 H2.5" />
        <path d="M227.7,100 V0 L270.2,100 L312.7,0 V100" />
        <path d="M361.7,0 V100" />
        <path d="M412.7,0 V97.5 H454.2" />
      </g>
      <path
        d="M135.6,-9.9 L163.73,9.75 A49.1,49.1 0 1 1 107.47,9.75 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="miter"
        strokeMiterlimit="20"
      />
      <circle cx="135.6" cy="50" r="7.61" fill="currentColor" />
    </svg>
  );
}

export function Mark({ className = "h-6 w-6", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      {compact ? (
        <>
          <path d="M60,20.04 L80.62,34.45 A36,36 0 1 1 39.38,34.45 Z" fill="none" stroke="currentColor" strokeWidth="6.84" strokeMiterlimit="20" />
          <circle cx="60" cy="63.96" r="9" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M60,17.82 L81.77,33.03 A38,38 0 1 1 38.23,33.03 Z" fill="none" stroke="currentColor" strokeWidth="3.88" strokeMiterlimit="20" />
          <circle cx="60" cy="64.18" r="5.89" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

// Mặt cắt quả bưởi, nét 1px
export function CrossSection({ className = "h-40 w-40" }: { className?: string }) {
  const spokes = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return { x: 100 + 62 * Math.sin(a), y: 100 - 62 * Math.cos(a) };
  });
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <circle cx="100" cy="100" r="96" />
      <circle cx="100" cy="100" r="88" />
      <circle cx="100" cy="100" r="62" />
      {spokes.map((p, i) => (
        <line key={i} x1="100" y1="100" x2={p.x.toFixed(2)} y2={p.y.toFixed(2)} />
      ))}
    </svg>
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
      <ellipse cx="120" cy="505" rx="104" ry="9" fill="#1e2420" opacity="0.12" />
      {/* Đầu xịt */}
      <rect x="92" y="8" width="56" height="64" rx="4" fill="#1e2420" />
      <rect x="146" y="22" width="16" height="10" rx="2" fill="#1e2420" />
      <rect x="80" y="70" width="80" height="78" rx="4" fill="#232a26" />
      {/* Thân chai */}
      <path d={`M20,190 Q20,160 60,156 L180,156 Q220,160 220,190 L220,488 Q220,500 208,500 L32,500 Q20,500 20,488 Z`} fill={`url(#${id}-g)`} />
      <g transform="translate(120 268) scale(0.29) translate(-227 -45)" color={t.ink}>
        <g fill="none" stroke="currentColor" strokeWidth="5">
          <path d="M2.5,100 V2.5 H24.5 A25,25 0 0 1 24.5,52.5 H2.5" />
          <path d="M227.7,100 V0 L270.2,100 L312.7,0 V100" />
          <path d="M361.7,0 V100" />
          <path d="M412.7,0 V97.5 H454.2" />
          <path d="M135.6,-9.9 L163.73,9.75 A49.1,49.1 0 1 1 107.47,9.75 Z" />
        </g>
        <circle cx="135.6" cy="50" r="7.61" fill="currentColor" />
      </g>
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
    </svg>
  );
}
