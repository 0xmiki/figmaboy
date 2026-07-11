import type { TextNode } from "$lib/domain";

export interface TextLayout {
  lines: string[];
  lineOffsets: number[];
  lineIndents: number[];
  width: number;
  height: number;
  lineHeight: number;
}

type Measure = (text: string, node: TextNode) => number;

let measureCanvas: HTMLCanvasElement | undefined;

export function measureText(text: string, node: TextNode): number {
  if (typeof globalThis.document !== "undefined") {
    measureCanvas ??= globalThis.document.createElement("canvas");
    const context = measureCanvas.getContext("2d");
    if (context) {
      context.font = `${node.fontStyle ?? "normal"} ${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`;
      return context.measureText(text).width + Math.max(0, text.length - 1) * node.letterSpacing;
    }
  }
  return text.length * node.fontSize * .56 + Math.max(0, text.length - 1) * node.letterSpacing;
}

export function displayedText(node: TextNode): string {
  if (node.textCase === "upper") return node.text.toUpperCase();
  if (node.textCase === "lower") return node.text.toLowerCase();
  if (node.textCase === "title") return node.text.replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  return node.text;
}

function splitLongWord(word: string, width: number, node: TextNode, measure: Measure): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of word) {
    const candidate = chunk + character;
    if (chunk && measure(candidate, node) > width) {
      chunks.push(chunk);
      chunk = character;
    } else chunk = candidate;
  }
  if (chunk) chunks.push(chunk);
  return chunks.length ? chunks : [""];
}

function wrapParagraph(paragraph: string, width: number, node: TextNode, measure: Measure): string[] {
  if (!paragraph) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, node) <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    const chunks = measure(word, node) > width ? splitLongWord(word, width, node, measure) : [word];
    lines.push(...chunks.slice(0, -1));
    line = chunks.at(-1) ?? "";
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

export function layoutText(node: TextNode, measure: Measure = measureText): TextLayout {
  const autoResize = node.textAutoResize ?? (node.autoWidth ? "width-and-height" : "height");
  const paragraphs = displayedText(node).split("\n");
  const lines: string[] = [];
  const lineOffsets: number[] = [];
  const lineIndents: number[] = [];
  const lineHeight = node.fontSize * node.lineHeight;
  let offset = 0;
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraphIndex > 0) offset += node.paragraphSpacing ?? 0;
    const wrapped = autoResize === "width-and-height"
      ? [paragraph]
      : wrapParagraph(paragraph, Math.max(1, node.width - Math.max(0, node.paragraphIndent ?? 0)), node, measure);
    wrapped.forEach((line, lineIndex) => {
      lines.push(line);
      lineOffsets.push(offset);
      lineIndents.push(lineIndex === 0 ? Math.max(0, node.paragraphIndent ?? 0) : 0);
      offset += lineHeight;
    });
  });
  if (!lines.length) { lines.push(""); lineOffsets.push(0); lineIndents.push(0); offset = lineHeight; }
  const maxLines = node.maxLines && node.maxLines > 0 ? Math.floor(node.maxLines) : null;
  if (node.textTruncation === "ending" && maxLines && lines.length > maxLines) {
    lines.length = maxLines;
    lineOffsets.length = maxLines;
    lineIndents.length = maxLines;
    let last = lines[maxLines - 1].replace(/\s+$/, "");
    if (autoResize !== "width-and-height") {
      const available = Math.max(1, node.width - lineIndents[maxLines - 1]);
      while (last && measure(`${last}…`, node) > available) last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
    offset = lineOffsets[maxLines - 1] + lineHeight;
  }
  return {
    lines,
    lineOffsets,
    lineIndents,
    width: Math.max(1, ...lines.map((line, index) => measure(line || " ", node) + lineIndents[index])),
    height: Math.max(lineHeight, offset),
    lineHeight,
  };
}

export function syncTextSize(node: TextNode, measure: Measure = measureText): TextLayout {
  const layout = layoutText(node, measure);
  const autoResize = node.textAutoResize ?? (node.autoWidth ? "width-and-height" : "height");
  node.autoWidth = autoResize === "width-and-height";
  if (autoResize === "width-and-height") node.width = layout.width;
  if (autoResize !== "none") node.height = layout.height;
  return layout;
}
