import type { TextNode } from "$lib/domain";

export interface TextLayout {
  lines: string[];
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
      context.font = `${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`;
      return context.measureText(text).width + Math.max(0, text.length - 1) * node.letterSpacing;
    }
  }
  return text.length * node.fontSize * .56 + Math.max(0, text.length - 1) * node.letterSpacing;
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
  const lines = node.autoWidth
    ? node.text.split("\n")
    : node.text.split("\n").flatMap((paragraph) => wrapParagraph(paragraph, Math.max(1, node.width), node, measure));
  const safeLines = lines.length ? lines : [""];
  const lineHeight = node.fontSize * node.lineHeight;
  return {
    lines: safeLines,
    width: Math.max(1, ...safeLines.map((line) => measure(line || " ", node))),
    height: Math.max(lineHeight, safeLines.length * lineHeight),
    lineHeight,
  };
}

export function syncTextSize(node: TextNode, measure: Measure = measureText): TextLayout {
  const layout = layoutText(node, measure);
  if (node.autoWidth) node.width = layout.width;
  node.height = layout.height;
  return layout;
}
