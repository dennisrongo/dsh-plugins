/**
 * A small markdown renderer for the subset a plan actually uses.
 *
 * Plans are model-written documents with headings, prose, bullet and numbered
 * lists, fenced code, blockquotes and rules. That is the whole grammar here —
 * no tables, no images, no HTML passthrough.
 *
 * Everything is built as **React elements**, never `dangerouslySetInnerHTML`.
 * A plan is untrusted text: it is written by a model, may quote a file that
 * came off the internet, and lands in the harness's own DOM. Building elements
 * means there is no escaping step to get wrong.
 *
 * Links render as `text (url)` rather than as anchors, deliberately. A plan is
 * model-authored, and a clickable link inside it is a navigation target the
 * user did not choose; showing the URL as text keeps it inspectable and inert.
 *
 * @module @dennisrongo/dsh-plan-board/markdown
 */
import React from 'react'

/** One parsed block of a plan. */
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; language: string; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'rule' }

/**
 * Split markdown into blocks.
 *
 * A single forward pass with an explicit fence flag — inside a fence nothing is
 * interpreted, which is what stops a `# ` in a shell snippet becoming a heading.
 * @param source - the plan's markdown.
 * @returns the parsed blocks in document order.
 */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  /** Flush any buffered prose into a paragraph block. */
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    const fence = /^\s*```(.*)$/.exec(line)
    if (fence) {
      flush()
      const body: string[] = []
      i += 1
      // An unterminated fence runs to the end of the document rather than
      // reverting to prose: a plan truncated mid-snippet should still show the
      // snippet as code.
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      blocks.push({ kind: 'code', language: fence[1].trim(), lines: body })
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flush()
      const isOrdered = ordered !== null
      const items: string[] = [(bullet ?? ordered)![1]]
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1]
        const next = isOrdered ? /^\s*\d+[.)]\s+(.*)$/.exec(nextLine) : /^\s*[-*+]\s+(.*)$/.exec(nextLine)
        if (next) {
          items.push(next[1])
          i += 1
          continue
        }
        // A wrapped continuation line belongs to the item above it.
        if (/^\s{2,}\S/.test(nextLine)) {
          items[items.length - 1] += ` ${nextLine.trim()}`
          i += 1
          continue
        }
        break
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items })
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flush()
      const body: string[] = [quote[1]]
      while (i + 1 < lines.length) {
        const next = /^\s*>\s?(.*)$/.exec(lines[i + 1])
        if (!next) break
        body.push(next[1])
        i += 1
      }
      blocks.push({ kind: 'quote', lines: body })
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

/** One span of inline-formatted text. */
type Span =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }

/**
 * Split one line into inline spans.
 *
 * Inline code is matched FIRST and its contents are never re-scanned, so
 * `**` inside a backtick span stays literal — the case that matters when a
 * plan quotes a glob or a pointer dereference.
 * @param text - one line of markdown.
 * @returns the spans in order.
 */
export function parseInline(text: string): Span[] {
  const spans: Span[] = []
  // Links collapse to `label (url)` before anything else, so their contents
  // are then formatted like ordinary prose.
  const flattened = text.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, url: string) =>
    label.trim() === url ? url : `${label} (${url})`,
  )
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(flattened)) !== null) {
    if (match.index > last) spans.push({ kind: 'text', text: flattened.slice(last, match.index) })
    const token = match[0]
    if (token.startsWith('`')) spans.push({ kind: 'code', text: token.slice(1, -1) })
    else if (token.startsWith('**') || token.startsWith('__')) spans.push({ kind: 'strong', text: token.slice(2, -2) })
    else spans.push({ kind: 'em', text: token.slice(1, -1) })
    last = match.index + token.length
  }
  if (last < flattened.length) spans.push({ kind: 'text', text: flattened.slice(last) })
  return spans
}

/**
 * Render inline spans.
 * @param text - one line of markdown.
 * @returns React children.
 */
function Inline({ text }: { text: string }): React.ReactElement {
  return (
    <>
      {parseInline(text).map((span, index) => {
        if (span.kind === 'code') {
          return (
            <code key={index} className="dshpb-icode">
              {span.text}
            </code>
          )
        }
        if (span.kind === 'strong') return <strong key={index}>{span.text}</strong>
        if (span.kind === 'em') return <em key={index}>{span.text}</em>
        return <React.Fragment key={index}>{span.text}</React.Fragment>
      })}
    </>
  )
}

/**
 * Render a plan's markdown.
 * @param props.source - the markdown body.
 * @returns the rendered document.
 */
export function Markdown({ source }: { source: string }): React.ReactElement {
  const blocks = React.useMemo(() => parseBlocks(source), [source])
  return (
    <div className="dshpb-md">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            // Heading levels map to one of three sizes on the shared type
            // scale; a plan nested six deep must not render at 8px.
            const cls = block.level <= 1 ? 'dshpb-h1' : block.level === 2 ? 'dshpb-h2' : 'dshpb-h3'
            return (
              <div key={index} className={cls}>
                <Inline text={block.text} />
              </div>
            )
          }
          case 'paragraph':
            return (
              <p key={index} className="dshpb-p">
                <Inline text={block.text} />
              </p>
            )
          case 'code':
            return (
              <pre key={index} className="dshpb-pre">
                <code>{block.lines.join('\n')}</code>
              </pre>
            )
          case 'list':
            return block.ordered ? (
              <ol key={index} className="dshpb-ol">
                {block.items.map((item, at) => (
                  <li key={at}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index} className="dshpb-ul">
                {block.items.map((item, at) => (
                  <li key={at}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            )
          case 'quote':
            return (
              <blockquote key={index} className="dshpb-quote">
                {block.lines.map((line, at) => (
                  <div key={at}>
                    <Inline text={line} />
                  </div>
                ))}
              </blockquote>
            )
          case 'rule':
          default:
            return <hr key={index} className="dshpb-hr" />
        }
      })}
    </div>
  )
}
