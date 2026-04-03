import * as React from "react";

type MarkdownVariant = "assistant" | "thinking";

type MarkdownBlock =
  | {
      kind: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
    }
  | {
      kind: "paragraph";
      lines: string[];
    }
  | {
      kind: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      kind: "blockquote";
      lines: string[];
    }
  | {
      kind: "code";
      language?: string;
      code: string;
    }
  | {
      kind: "rule";
    };

const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;
const RULE_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const UNORDERED_LIST_RE = /^ {0,3}[-*+]\s+(.*)$/;
const ORDERED_LIST_RE = /^ {0,3}\d+\.\s+(.*)$/;
const BLOCKQUOTE_RE = /^ {0,3}>\s?(.*)$/;
const FENCE_RE = /^ {0,3}```\s*([A-Za-z0-9_-]+)?\s*$/;
const INLINE_TOKEN_RE =
  /(\[[^\]]+\]\(([^)]+)\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

function flushParagraph(
  blocks: MarkdownBlock[],
  paragraphLines: string[],
): void {
  if (paragraphLines.length === 0) return;
  blocks.push({
    kind: "paragraph",
    lines: [...paragraphLines],
  });
  paragraphLines.length = 0;
}

function flushList(
  blocks: MarkdownBlock[],
  listState: { ordered: boolean; items: string[] } | null,
): null {
  if (!listState || listState.items.length === 0) return null;
  blocks.push({
    kind: "list",
    ordered: listState.ordered,
    items: [...listState.items],
  });
  return null;
}

function flushBlockquote(
  blocks: MarkdownBlock[],
  quoteLines: string[],
): void {
  if (quoteLines.length === 0) return;
  blocks.push({
    kind: "blockquote",
    lines: [...quoteLines],
  });
  quoteLines.length = 0;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const paragraphLines: string[] = [];
  const quoteLines: string[] = [];
  let listState: { ordered: boolean; items: string[] } | null = null;
  let codeLanguage: string | undefined;
  let codeLines: string[] | null = null;

  const flushTextBlocks = () => {
    flushParagraph(blocks, paragraphLines);
    listState = flushList(blocks, listState);
    flushBlockquote(blocks, quoteLines);
  };

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      flushTextBlocks();
      if (codeLines) {
        blocks.push({
          kind: "code",
          language: codeLanguage,
          code: codeLines.join("\n"),
        });
        codeLines = null;
        codeLanguage = undefined;
      } else {
        codeLanguage = fenceMatch[1] || undefined;
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushTextBlocks();
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushTextBlocks();
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2],
      });
      continue;
    }

    if (RULE_RE.test(line)) {
      flushTextBlocks();
      blocks.push({ kind: "rule" });
      continue;
    }

    const blockquoteMatch = line.match(BLOCKQUOTE_RE);
    if (blockquoteMatch) {
      flushParagraph(blocks, paragraphLines);
      listState = flushList(blocks, listState);
      quoteLines.push(blockquoteMatch[1]);
      continue;
    }

    if (quoteLines.length > 0) {
      flushBlockquote(blocks, quoteLines);
    }

    const orderedMatch = line.match(ORDERED_LIST_RE);
    if (orderedMatch) {
      flushParagraph(blocks, paragraphLines);
      if (!listState || !listState.ordered) {
        listState = flushList(blocks, listState);
        listState = { ordered: true, items: [] };
      }
      listState.items.push(orderedMatch[1]);
      continue;
    }

    const unorderedMatch = line.match(UNORDERED_LIST_RE);
    if (unorderedMatch) {
      flushParagraph(blocks, paragraphLines);
      if (!listState || listState.ordered) {
        listState = flushList(blocks, listState);
        listState = { ordered: false, items: [] };
      }
      listState.items.push(unorderedMatch[1]);
      continue;
    }

    if (listState && listState.items.length > 0) {
      const lastItemIndex = listState.items.length - 1;
      listState.items[lastItemIndex] = `${listState.items[lastItemIndex]}\n${line.trim()}`;
      continue;
    }

    paragraphLines.push(line);
  }

  flushTextBlocks();
  if (codeLines) {
    blocks.push({
      kind: "code",
      language: codeLanguage,
      code: codeLines.join("\n"),
    });
  }
  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={`${keyPrefix}:${start}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="text-sky underline underline-offset-2 transition-colors hover:text-sky-700"
          >
            {renderInlineMarkdown(linkMatch[1], `${keyPrefix}:${start}:link`)}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <strong key={`${keyPrefix}:${start}`} className="font-semibold text-foreground">
          {renderInlineMarkdown(token.slice(2, -2), `${keyPrefix}:${start}:strong`)}
        </strong>,
      );
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      nodes.push(
        <em key={`${keyPrefix}:${start}`} className="italic">
          {renderInlineMarkdown(token.slice(1, -1), `${keyPrefix}:${start}:em`)}
        </em>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}:${start}`}
          className="rounded bg-panel-400/80 px-1 py-0.5 font-mono text-[0.92em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(token);
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderLinesWithBreaks(lines: string[], keyPrefix: string): React.ReactNode {
  return lines.map((line, index) => (
    <React.Fragment key={`${keyPrefix}:${index}`}>
      {index > 0 && <br />}
      {renderInlineMarkdown(line, `${keyPrefix}:${index}`)}
    </React.Fragment>
  ));
}

export function MarkdownMessage({
  content,
  variant = "assistant",
  className = "",
}: {
  content: string;
  variant?: MarkdownVariant;
  className?: string;
}) {
  const blocks = React.useMemo(() => parseMarkdownBlocks(content), [content]);
  const isThinking = variant === "thinking";
  const rootClassName = [
    "space-y-3 break-words",
    isThinking
      ? "text-[12px] leading-relaxed text-foreground/55"
      : "text-[13px] leading-relaxed text-foreground",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      {blocks.map((block, index) => {
        const key = `${block.kind}:${index}`;

        if (block.kind === "heading") {
          const headingClassName = isThinking
            ? "font-semibold text-foreground/70"
            : "font-semibold text-foreground";

          switch (block.level) {
            case 1:
              return (
                <h1 key={key} className={`text-[16px] ${headingClassName}`}>
                  {renderInlineMarkdown(block.text, key)}
                </h1>
              );
            case 2:
              return (
                <h2 key={key} className={`text-[15px] ${headingClassName}`}>
                  {renderInlineMarkdown(block.text, key)}
                </h2>
              );
            case 3:
              return (
                <h3 key={key} className={`text-[14px] ${headingClassName}`}>
                  {renderInlineMarkdown(block.text, key)}
                </h3>
              );
            default:
              return (
                <h4 key={key} className={`text-[13px] ${headingClassName}`}>
                  {renderInlineMarkdown(block.text, key)}
                </h4>
              );
          }
        }

        if (block.kind === "paragraph") {
          return (
            <p key={key}>
              {renderLinesWithBreaks(block.lines, key)}
            </p>
          );
        }

        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={key}
              className={`ml-5 space-y-1 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}:${itemIndex}`}>
                  {renderLinesWithBreaks(item.split("\n"), `${key}:${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        if (block.kind === "blockquote") {
          return (
            <blockquote
              key={key}
              className="border-l-2 border-border-500 pl-3 italic text-foreground/70"
            >
              {renderLinesWithBreaks(block.lines, key)}
            </blockquote>
          );
        }

        if (block.kind === "code") {
          return (
            <div
              key={key}
              className="overflow-hidden rounded-lg border border-border-500/60 bg-panel-700"
            >
              {block.language && (
                <div className="border-b border-border-500/60 px-3 py-1.5 text-[11px] uppercase tracking-wide text-foreground/45">
                  {block.language}
                </div>
              )}
              <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground/85">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        return <div key={key} className="border-t border-border-500/60" />;
      })}
    </div>
  );
}
