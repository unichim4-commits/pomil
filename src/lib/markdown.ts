// Markdown rút gọn cho trang nội dung và mô tả sản phẩm. Thoát HTML trước, nên người soạn
// không chèn được thẻ script. Hỗ trợ: ## ### tiêu đề, - danh sách, 1. danh sách số, > trích dẫn,
// **đậm**, *nghiêng*, [chữ](liên kết), dòng trống tách đoạn.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(u)) return u;
  return null;
}

function inline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, "&"));
    if (!href) return label;
    const external = /^https?:\/\//i.test(href);
    return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join("<br />")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(inline).join("<br />")}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flushAll();
    } else if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
      flushAll();
      const level = m[1]!.length;
      out.push(`<h${level}>${inline(m[2]!)}</h${level}>`);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(m[1]!);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(m[1]!);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushParagraph();
      flushList();
      quote.push(m[1]!);
    } else {
      flushList();
      flushQuote();
      paragraph.push(line.trim());
    }
  }
  flushAll();
  return out.join("\n");
}

// Lấy chữ thuần để làm mô tả SEO
export function plainText(md: string, max = 160): string {
  const text = md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
