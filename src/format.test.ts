import assert from "node:assert/strict";
import test from "node:test";
import { markdownToStorage, storageToMarkdown } from "./format";

test("converts headings and inline formatting to storage XHTML", () => {
  assert.equal(markdownToStorage("# Title\n\nHello **world** and `code`."), "<h1>Title</h1>\n<p>Hello <strong>world</strong> and <code>code</code>.</p>");
});

test("converts basic storage XHTML to Markdown", () => {
  assert.match(storageToMarkdown("<h1>Title</h1><p>Hello <strong>world</strong>.</p>"), /# Title[\s\S]*\*\*world\*\*/);
});

test("converts Confluence tables to GFM Markdown tables", () => {
  const storage = "<table><tbody><tr><td><p><strong>Riesgo</strong></p></td><td><p><strong>Impacto</strong></p></td><td><p><strong>Mitigación</strong></p></td></tr><tr><td><p>Datos retrasados</p></td><td><p>Indicadores no vigentes</p></td><td><p>Mostrar timestamp</p></td></tr></tbody></table>";
  assert.equal(storageToMarkdown(storage), "| **Riesgo** | **Impacto** | **Mitigación** |\n| --- | --- | --- |\n| Datos retrasados | Indicadores no vigentes | Mostrar timestamp |");
});
