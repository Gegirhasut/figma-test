// Minimal XML scanner for Figma SVG exports. It keeps the exact source offsets
// of every element so that object markup can be copied byte-for-byte.

export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  /** Offset of '<' of the opening tag. */
  start: number;
  /** Offset just after the opening tag '>'. */
  openEnd: number;
  /** Offset of '<' of the closing tag (== openEnd for self-closing). */
  closeStart: number;
  /** Offset just after the element. */
  end: number;
  children: XNode[];
  parent: XNode | null;
}

const TAG_RE = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->/g;
const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, start: 0, openEnd: 0, closeStart: src.length, end: src.length, children: [], parent: null };
  let cur = root;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    if (!m[2]) continue; // declaration or comment
    const [whole, closing, tag, attrText, selfClose] = m;
    if (closing) {
      if (cur.tag !== tag) throw new Error(`mismatched </${tag}> at ${m.index}, open <${cur.tag}>`);
      cur.closeStart = m.index;
      cur.end = m.index + whole.length;
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(attrText))) attrs[a[1]] = a[2];
    const node: XNode = {
      tag,
      attrs,
      start: m.index,
      openEnd: m.index + whole.length,
      closeStart: m.index + whole.length,
      end: m.index + whole.length,
      children: [],
      parent: cur,
    };
    cur.children.push(node);
    if (!selfClose) cur = node;
  }
  if (cur !== root) throw new Error(`unclosed <${cur.tag}>`);
  return root;
}

/** Figma writes UTF-8 bytes of layer names as Latin-1 numeric entities: decode them back to text. */
export function decodeFigmaName(raw: string): string {
  const latin1 = raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  const bytes = Uint8Array.from(latin1, (c) => c.charCodeAt(0) & 0xff);
  // Only re-decode when every char fits in a byte (otherwise the name was already Unicode).
  if ([...latin1].some((c) => c.charCodeAt(0) > 0xff)) return latin1;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/&amp;/g, '&');
}

export function* walk(node: XNode): Generator<XNode> {
  for (const c of node.children) {
    yield c;
    yield* walk(c);
  }
}
