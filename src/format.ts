import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { sanitizeName } from "./paths";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.use(gfm);
turndown.addRule("confluenceSpan", {
  filter: (node) => node.nodeName === "SPAN" && !!node.getAttribute("style"),
  replacement: (content, node: any) => {
    const style = node.getAttribute("style") as string;
    return `<span style="${style}">${content}</span>`;
  },
});

export function storageToMarkdown(storage: string): string {
  return turndown.turndown(normalizeConfluenceLinks(normalizeAttachmentImages(normalizeTableCells(storage || ""))));
}

function normalizeAttachmentImages(storage: string): string {
  return storage.replace(/<ac:image\b([^>]*)>\s*<ri:attachment\b([^>]*)\/?>(?:\s*<\/ri:attachment>)?\s*<\/ac:image>/gi, (macro, imageAttributes: string, attachmentAttributes: string) => {
    const filename = /ri:filename="([^"]+)"/i.exec(attachmentAttributes)?.[1];
    if (!filename) return macro;
    const alt = /ac:alt="([^"]*)"/i.exec(imageAttributes)?.[1] || "";
    return `<img src="attachments/${sanitizeName(filename)}" alt="${alt}">`;
  });
}

function normalizeConfluenceLinks(storage: string): string {
  return storage.replace(/<ac:link\b[^>]*>\s*<ri:page\b[^>]*\bri:content-title="([^"]*)"[^>]*\/?>\s*(?:<ac:link-body>([\s\S]*?)<\/ac:link-body>)?\s*<\/ac:link>/gi, (_, title: string, body: string | undefined) => {
    const decodedTitle = decodeXmlEntities(title);
    const text = body ? decodeXmlEntities(body.replace(/<[^>]+>/g, "").trim()) : decodedTitle;
    return `<a href="confluence-page://${encodeURIComponent(decodedTitle)}">${text}</a>`;
  });
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (_, name: string) => xmlEntities[name] || `&${name};`);
}

const xmlEntities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  Aacute: "Á", aacute: "á", Acirc: "Â", acirc: "â", Agrave: "À", agrave: "à", Aring: "Å", aring: "å", Atilde: "Ã", atilde: "ã", Auml: "Ä", auml: "ä",
  Eacute: "É", eacute: "é", Ecirc: "Ê", ecirc: "ê", Egrave: "È", egrave: "è", Euml: "Ë", euml: "ë",
  Iacute: "Í", iacute: "í", Icirc: "Î", icirc: "î", Igrave: "Ì", igrave: "ì", Iuml: "Ï", iuml: "ï",
  Oacute: "Ó", oacute: "ó", Ocirc: "Ô", ocirc: "ô", Ograve: "Ò", ograve: "ò", Otilde: "Õ", otilde: "õ", Ouml: "Ö", ouml: "ö",
  Uacute: "Ú", uacute: "ú", Ucirc: "Û", ucirc: "û", Ugrave: "Ù", ugrave: "ù", Uuml: "Ü", uuml: "ü",
  Ntilde: "Ñ", ntilde: "ñ", Ccedil: "Ç", ccedil: "ç", Yacute: "Ý", yacute: "ý",
  iquest: "¿", iexcl: "¡", nbsp: " ", shy: "",
};

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
  const { text, spans } = preserveInlineHtml(markdown);
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  return restoreInlineHtml(restoreConfluenceLinks(output.join("\n")), spans);
}

function restoreConfluenceLinks(storage: string): string {
  return storage.replace(/<a href="confluence-page:\/\/([^"]+)">([\s\S]*?)<\/a>/g, (_, encodedTitle: string, body: string) => {
    const href = encodedTitle.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    const title = decodeURIComponent(href);
    return `<ac:link ac:card-appearance="inline"><ri:page ri:content-title="${title}" /><ac:link-body>${body}</ac:link-body></ac:link>`;
  });
}

function preserveInlineHtml(markdown: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  const text = markdown.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, (match) => {
    spans.push(match);
    return `@@CSPAN${spans.length - 1}@@`;
  });
  return { text, spans };
}

function restoreInlineHtml(storage: string, spans: string[]): string {
  let result = storage;
  for (let i = 0; i < spans.length; i++) {
    result = result.split(`@@CSPAN${i}@@`).join(spans[i]);
  }
  return result;
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
  return value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, src: string) => {
    const filename = decodeURIComponent(src.replace(/^attachments\//, ""));
    return `<ac:image ac:alt="${alt}"><ri:attachment ri:filename="${filename}" /></ac:image>`;
  })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
