import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.use(gfm);

export function storageToMarkdown(storage: string): string {
  return turndown.turndown(normalizeTableCells(storage || ""));
}

function normalizeTableCells(storage: string): string {
  return storage.replace(/<table\b[\s\S]*?<\/table>/gi, table => {
    let normalized = table
      .replace(/<\/p>\s*<p\b[^>]*>/gi, "<br>")
      .replace(/<p\b[^>]*>/gi, "")
      .replace(/<\/p>/gi, "");
    if (!/<th\b/i.test(normalized)) {
      normalized = normalized.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/i, (_, attributes: string, cells: string) =>
        `<tr${attributes}>${cells.replace(/<td\b/gi, "<th").replace(/<\/td>/gi, "</th>")}</tr>`);
    }
    return normalized;
  });
}

interface CodeBlock { lang?: string; lines: string[]; }

export function markdownToStorage(markdown: string): string {
  const escaped = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  const output: string[] = [];
  let paragraph: string[] = [];
  let table: string[][] | null = null;
  let tableHasHeader = false;
  let list: string[] | null = null;
  let listOrdered = false;
  let blockquote: string[] | null = null;
  let codeBlock: CodeBlock | null = null;

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushTable = () => {
    if (!table) return;
    const rows: string[] = [];
    table.forEach((cells, index) => {
      const tag = tableHasHeader && index === 0 ? "th" : "td";
      rows.push(`<tr>${cells.map(cell => `<${tag}>${inline(cell)}</${tag}>`).join("")}</tr>`);
    });
    output.push(`<table><tbody>${rows.join("")}</tbody></table>`);
    table = null;
    tableHasHeader = false;
  };

  const flushList = () => {
    if (!list) return;
    const items = list.map(item => `<li>${inline(item)}</li>`).join("");
    output.push(listOrdered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
    list = null;
    listOrdered = false;
  };

  const flushBlockquote = () => {
    if (!blockquote) return;
    output.push(`<blockquote><p>${inline(blockquote.join("<br>"))}</p></blockquote>`);
    blockquote = null;
  };

  const flushCode = () => {
    if (!codeBlock) return;
    const code = codeBlock.lines.join("\n");
    const langAttr = codeBlock.lang ? ` class="${codeBlock.lang}"` : "";
    output.push(`<pre><code${langAttr}>${code}</code></pre>`);
    codeBlock = null;
  };

  const flushAllBlocks = () => {
    flushParagraph();
    flushTable();
    flushList();
    flushBlockquote();
    flushCode();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (codeBlock) {
      if (/^```\s*$/.test(line)) { flushCode(); continue; }
      codeBlock.lines.push(line);
      continue;
    }

    const codeFence = /^```(\w*)\s*$/.exec(line);
    if (codeFence) { flushAllBlocks(); codeBlock = { lang: codeFence[1] || undefined, lines: [] }; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { flushAllBlocks(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }

    if (/^\|(.+)\|$/.test(line)) {
      flushParagraph(); flushList(); flushBlockquote(); flushCode();
      const cells = parseTableRow(line);
      if (!table) {
        const next = lines[i + 1];
        if (next && isTableSeparator(next)) { tableHasHeader = true; i++; }
        table = [cells];
      } else {
        table.push(cells);
      }
      continue;
    }
    if (table) flushTable();

    const bullet = /^[*-]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph(); flushTable(); flushBlockquote(); flushCode();
      if (!list) { list = []; listOrdered = false; }
      list.push(bullet[1]);
      continue;
    }
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph(); flushTable(); flushBlockquote(); flushCode();
      if (!list) { list = []; listOrdered = true; }
      list.push(ordered[1]);
      continue;
    }
    if (list) flushList();

    const bq = /^&gt;\s*(.*)$/.exec(line);
    if (bq) {
      flushParagraph(); flushTable(); flushList(); flushCode();
      if (!blockquote) blockquote = [];
      blockquote.push(bq[1]);
      continue;
    }
    if (blockquote) flushBlockquote();

    if (!line.trim()) flushParagraph();
    else paragraph.push(line.trim());
  }

  flushAllBlocks();
  return output.join("\n");
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.slice(1, -1);
  return inner.split("|").map(cell => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!/^\|(.+)\|$/.test(trimmed)) return false;
  const inner = trimmed.slice(1, -1);
  return inner.split("|").every(cell => /^\s*:?-+:?\s*$/.test(cell.trim()));
}

function inline(value: string): string {
  return value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<ac:image ac:alt="$1"><ri:attachment ri:filename="$2" /></ac:image>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
