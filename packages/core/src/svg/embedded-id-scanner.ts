import { FatalError } from "../errors.js";

export type ScannedEmbeddedSvgReferenceKind =
  | "url"
  | "href"
  | "xlink:href"
  | "aria"
  | "smil"
  | "css-selector";

export type ScannedEmbeddedSvgReferenceSyntax =
  | "url"
  | "fragment"
  | "single"
  | "list"
  | "id-selector"
  | "syncbase"
  | "eventbase"
  | "repeat"
  | "marker"
  | "deprecated-id";

type ScannedEmbeddedSvgReference = {
  id: string;
  kind: ScannedEmbeddedSvgReferenceKind;
  attribute: string;
  syntax: ScannedEmbeddedSvgReferenceSyntax;
  raw: string;
  start: number;
};

type EmbeddedSvgIdScan = {
  ids: string[];
  references: ScannedEmbeddedSvgReference[];
};

type TextRange = {
  start: number;
  end: number;
};

type ScannedAttribute = {
  name: string;
  value: TextRange;
  raw: TextRange;
};

type ScannedElement = {
  attributes: ScannedAttribute[];
};

type XmlScan = {
  elements: ScannedElement[];
  styleBodies: TextRange[];
};

type ReferenceEncoding = "xml" | "css-or-smil";

type ReferenceScanContext = {
  svg: string;
  definitions: ReadonlySet<string>;
  references: ScannedEmbeddedSvgReference[];
};

type AddReferenceOptions = {
  idRange: TextRange;
  rawRange: TextRange;
  encoding: ReferenceEncoding;
  metadata: Pick<ScannedEmbeddedSvgReference, "attribute" | "kind" | "syntax">;
};

const MALFORMED_XML = "CONTENT_ID_PREFIX_MALFORMED_XML";
const UNSUPPORTED_REFERENCE = "CONTENT_ID_PREFIX_UNSUPPORTED_REFERENCE";

const ARIA_SINGLE = new Set(["aria-activedescendant", "aria-details", "aria-errormessage"]);
const ARIA_LIST = new Set([
  "aria-controls",
  "aria-describedby",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
]);
const URL_REFERENCE_ATTRIBUTES = new Set([
  "clip-path",
  "color-profile",
  "cursor",
  "fill",
  "filter",
  "marker",
  "marker-start",
  "marker-mid",
  "marker-end",
  "mask",
  "stroke",
  "style",
]);

function scanError(code: string, detail: string): never {
  throw new FatalError(code, `Embedded SVG ID analysis failed: ${detail}`, {
    stage: "analyzer",
  });
}

function isXmlSpaceCode(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

function isNameStartCode(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x3a ||
    code >= 0x80
  );
}

function isNameCode(code: number): boolean {
  return isNameStartCode(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x2e;
}

function isCssNameCode(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2d ||
    code === 0x5f ||
    code >= 0x80
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: XML tokenization must track markup kinds, quotes, declarations, and style body boundaries.
function scanXml(svg: string): XmlScan {
  const elements: ScannedElement[] = [];
  const styleStack: number[] = [];
  const styleBodies: TextRange[] = [];
  let cursor = 0;

  while (cursor < svg.length) {
    const opening = svg.indexOf("<", cursor);
    if (opening < 0) {
      break;
    }
    if (svg.startsWith("<!--", opening)) {
      const end = svg.indexOf("-->", opening + 4);
      if (end < 0) {
        scanError(MALFORMED_XML, "unterminated comment");
      }
      cursor = end + 3;
      continue;
    }
    if (svg.startsWith("<![CDATA[", opening)) {
      const end = svg.indexOf("]]>", opening + 9);
      if (end < 0) {
        scanError(MALFORMED_XML, "unterminated CDATA");
      }
      cursor = end + 3;
      continue;
    }
    if (svg.startsWith("<?", opening)) {
      const end = svg.indexOf("?>", opening + 2);
      if (end < 0) {
        scanError(MALFORMED_XML, "unterminated processing instruction");
      }
      cursor = end + 2;
      continue;
    }
    if (svg.startsWith("<!", opening)) {
      let index = opening + 2;
      let quote = 0;
      let bracketDepth = 0;
      for (; index < svg.length; index += 1) {
        const code = svg.charCodeAt(index);
        if (quote !== 0) {
          if (code === quote) {
            quote = 0;
          }
        } else if (code === 0x22 || code === 0x27) {
          quote = code;
        } else if (code === 0x5b) {
          bracketDepth += 1;
        } else if (code === 0x5d && bracketDepth > 0) {
          bracketDepth -= 1;
        } else if (code === 0x3e && bracketDepth === 0) {
          break;
        }
      }
      if (index >= svg.length) {
        scanError(MALFORMED_XML, "unterminated declaration");
      }
      cursor = index + 1;
      continue;
    }

    let index = opening + 1;
    const closing = svg.charCodeAt(index) === 0x2f;
    if (closing) {
      index += 1;
    }
    if (!isNameStartCode(svg.charCodeAt(index))) {
      scanError(MALFORMED_XML, `invalid tag at character ${opening}`);
    }
    const nameStart = index;
    while (index < svg.length && isNameCode(svg.charCodeAt(index))) {
      index += 1;
    }
    const name = svg.slice(nameStart, index);

    if (closing) {
      while (index < svg.length && isXmlSpaceCode(svg.charCodeAt(index))) {
        index += 1;
      }
      if (svg.charCodeAt(index) !== 0x3e) {
        scanError(MALFORMED_XML, `malformed closing tag ${name}`);
      }
      if (name === "style") {
        const bodyStart = styleStack.pop();
        if (bodyStart === undefined) {
          scanError(MALFORMED_XML, "unmatched </style>");
        }
        styleBodies.push({ start: bodyStart, end: opening });
      }
      cursor = index + 1;
      continue;
    }

    const attributes: ScannedAttribute[] = [];
    const attributeNames = new Set<string>();
    let selfClosing = false;
    while (index < svg.length) {
      while (index < svg.length && isXmlSpaceCode(svg.charCodeAt(index))) {
        index += 1;
      }
      if (svg.charCodeAt(index) === 0x3e) {
        index += 1;
        break;
      }
      if (svg.charCodeAt(index) === 0x2f && svg.charCodeAt(index + 1) === 0x3e) {
        selfClosing = true;
        index += 2;
        break;
      }
      if (!isNameStartCode(svg.charCodeAt(index))) {
        scanError(MALFORMED_XML, `invalid attribute on ${name} at character ${index}`);
      }
      const attributeStart = index;
      while (index < svg.length && isNameCode(svg.charCodeAt(index))) {
        index += 1;
      }
      const attributeName = svg.slice(attributeStart, index);
      if (attributeNames.has(attributeName)) {
        scanError(MALFORMED_XML, `duplicate ${attributeName} attribute on ${name}`);
      }
      attributeNames.add(attributeName);
      while (index < svg.length && isXmlSpaceCode(svg.charCodeAt(index))) {
        index += 1;
      }
      if (svg.charCodeAt(index) !== 0x3d) {
        scanError(MALFORMED_XML, `attribute ${attributeName} has no equals sign`);
      }
      index += 1;
      while (index < svg.length && isXmlSpaceCode(svg.charCodeAt(index))) {
        index += 1;
      }
      const quote = svg.charCodeAt(index);
      if (quote !== 0x22 && quote !== 0x27) {
        scanError(MALFORMED_XML, `attribute ${attributeName} is not quoted`);
      }
      const valueStart = index + 1;
      const valueEnd = svg.indexOf(String.fromCharCode(quote), valueStart);
      if (valueEnd < 0) {
        scanError(MALFORMED_XML, `unterminated ${attributeName} value`);
      }
      const unexpectedOpening = svg.indexOf("<", valueStart);
      if (unexpectedOpening >= 0 && unexpectedOpening < valueEnd) {
        scanError(MALFORMED_XML, `attribute ${attributeName} contains an unescaped '<'`);
      }
      attributes.push({
        name: attributeName,
        value: { start: valueStart, end: valueEnd },
        raw: { start: attributeStart, end: valueEnd + 1 },
      });
      index = valueEnd + 1;
    }
    if (index >= svg.length && svg.charCodeAt(index - 1) !== 0x3e) {
      scanError(MALFORMED_XML, `unterminated ${name} tag`);
    }
    elements.push({ attributes });
    if (name === "style" && !selfClosing) {
      styleStack.push(index);
    }
    cursor = index;
  }
  if (styleStack.length > 0) {
    scanError(MALFORMED_XML, "unterminated <style>");
  }
  return { elements, styleBodies };
}

function isValidXmlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: XML entity decoding must distinguish named, decimal, hexadecimal, and literal sequences.
function decodeXml(raw: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < raw.length) {
    const opening = raw.indexOf("&", cursor);
    if (opening < 0) {
      output += raw.slice(cursor);
      break;
    }
    output += raw.slice(cursor, opening);
    const close = raw.indexOf(";", opening + 1);
    if (close < 0) {
      output += raw.slice(opening);
      break;
    }
    const entity = raw.slice(opening + 1, close);
    let decoded: string | undefined;
    if (entity === "amp") {
      decoded = "&";
    } else if (entity === "lt") {
      decoded = "<";
    } else if (entity === "gt") {
      decoded = ">";
    } else if (entity === "quot") {
      decoded = '"';
    } else if (entity === "apos") {
      decoded = "'";
    } else if (entity.startsWith("#x") || entity.startsWith("#X")) {
      decoded = decodeNumericEntity(entity, 16, 2);
    } else if (entity.startsWith("#")) {
      decoded = decodeNumericEntity(entity, 10, 1);
    }
    output += decoded ?? raw.slice(opening, close + 1);
    cursor = close + 1;
  }
  return output;
}

function decodeNumericEntity(entity: string, radix: number, digitsStart: number): string {
  const digits = entity.slice(digitsStart);
  if (digits.length === 0 || !digits.split("").every((digit) => isDigitForRadix(digit, radix))) {
    scanError(MALFORMED_XML, `invalid entity &${entity};`);
  }
  const codePoint = Number.parseInt(digits, radix);
  if (!Number.isSafeInteger(codePoint) || !isValidXmlCodePoint(codePoint)) {
    scanError(MALFORMED_XML, `invalid XML code point in &${entity};`);
  }
  return String.fromCodePoint(codePoint);
}

function isDigitForRadix(digit: string, radix: number): boolean {
  if (radix === 10) {
    return digit >= "0" && digit <= "9";
  }
  return /[0-9a-fA-F]/.test(digit);
}

function decodeCssOrSmilEscapes(raw: string): string {
  let output = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "\\") {
      output += raw[index];
      continue;
    }
    index += 1;
    if (index >= raw.length) {
      scanError(UNSUPPORTED_REFERENCE, "trailing identifier escape");
    }
    const hexMatch = raw.slice(index).match(/^[0-9a-fA-F]{1,6}/);
    if (hexMatch === null) {
      output += raw[index];
      continue;
    }
    const codePoint = Number.parseInt(hexMatch[0], 16);
    output += String.fromCodePoint(codePoint === 0 || codePoint > 0x10ffff ? 0xfffd : codePoint);
    index += hexMatch[0].length - 1;
    if (/\s/.test(raw[index + 1] ?? "")) {
      index += 1;
    }
  }
  return output;
}

function decodeReference(raw: string, encoding: ReferenceEncoding): string {
  const xmlDecoded = decodeXml(raw);
  return encoding === "xml" ? xmlDecoded : decodeCssOrSmilEscapes(xmlDecoded);
}

function addReference(context: ReferenceScanContext, options: AddReferenceOptions): string {
  const id = decodeReference(
    context.svg.slice(options.idRange.start, options.idRange.end),
    options.encoding,
  );
  context.references.push({
    ...options.metadata,
    id,
    raw: context.svg.slice(options.rawRange.start, options.rawRange.end),
    start: options.rawRange.start,
  });
  return id;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSS url() tokenization must preserve malformed unknown references while rejecting malformed known-local references.
function scanUrlReferences(
  context: ReferenceScanContext,
  range: TextRange,
  attribute: string,
): void {
  const { definitions, svg } = context;
  let cursor = range.start;
  while (cursor < range.end) {
    if (svg.startsWith("/*", cursor)) {
      const commentEnd = svg.indexOf("*/", cursor + 2);
      if (commentEnd < 0 || commentEnd >= range.end) {
        scanError(UNSUPPORTED_REFERENCE, "unterminated CSS comment");
      }
      cursor = commentEnd + 2;
      continue;
    }
    const quote = svg.charCodeAt(cursor);
    if (quote === 0x22 || quote === 0x27) {
      cursor += 1;
      while (cursor < range.end) {
        if (svg.charCodeAt(cursor) === 0x5c) {
          cursor = Math.min(cursor + 2, range.end);
        } else if (svg.charCodeAt(cursor) === quote) {
          cursor += 1;
          break;
        } else {
          cursor += 1;
        }
      }
      continue;
    }
    if (svg.slice(cursor, cursor + 3).toLowerCase() !== "url") {
      cursor += 1;
      continue;
    }
    const previous = cursor > range.start ? svg.charCodeAt(cursor - 1) : 0;
    if (isCssNameCode(previous)) {
      cursor += 3;
      continue;
    }
    const urlStart = cursor;
    let index = cursor + 3;
    while (index < range.end && isXmlSpaceCode(svg.charCodeAt(index))) {
      index += 1;
    }
    if (svg.charCodeAt(index) !== 0x28) {
      cursor += 3;
      continue;
    }
    index += 1;
    while (index < range.end && isXmlSpaceCode(svg.charCodeAt(index))) {
      index += 1;
    }
    const innerQuoteCode = svg.charCodeAt(index);
    const innerQuote = innerQuoteCode === 0x22 || innerQuoteCode === 0x27 ? innerQuoteCode : 0;
    if (innerQuote !== 0) {
      index += 1;
    }
    while (index < range.end && isXmlSpaceCode(svg.charCodeAt(index))) {
      index += 1;
    }
    if (svg.charCodeAt(index) !== 0x23) {
      const close = svg.indexOf(")", index);
      cursor = close < 0 || close >= range.end ? range.end : close + 1;
      continue;
    }
    const idStart = index + 1;
    index = idStart;
    while (index < range.end) {
      const code = svg.charCodeAt(index);
      if (code === 0x5c && index + 1 < range.end) {
        index += 2;
      } else if (
        (innerQuote !== 0 && code === innerQuote) ||
        (innerQuote === 0 && (isXmlSpaceCode(code) || code === 0x29))
      ) {
        break;
      } else {
        index += 1;
      }
    }
    const idEnd = index;
    let decodedId: string | undefined;
    try {
      decodedId = decodeReference(svg.slice(idStart, idEnd), "css-or-smil");
    } catch (error) {
      if (error instanceof FatalError) {
        decodedId = undefined;
      } else {
        throw error;
      }
    }
    if (innerQuote !== 0) {
      if (svg.charCodeAt(index) !== innerQuote) {
        if (decodedId !== undefined && definitions.has(decodedId)) {
          scanError(UNSUPPORTED_REFERENCE, "unterminated quoted url()");
        }
        cursor = range.end;
        continue;
      }
      index += 1;
    }
    while (index < range.end && isXmlSpaceCode(svg.charCodeAt(index))) {
      index += 1;
    }
    if (svg.charCodeAt(index) !== 0x29) {
      if (decodedId !== undefined && definitions.has(decodedId)) {
        scanError(UNSUPPORTED_REFERENCE, "unterminated url()");
      }
      cursor = range.end;
      continue;
    }
    addReference(context, {
      idRange: { start: idStart, end: idEnd },
      rawRange: { start: urlStart, end: index + 1 },
      encoding: "css-or-smil",
      metadata: { attribute, kind: "url", syntax: "url" },
    });
    cursor = index + 1;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSS selector tokenization must skip comments, strings, and escaped identifier bytes.
function scanCssSelectorHashes(context: ReferenceScanContext, range: TextRange): void {
  const { svg } = context;
  let cursor = range.start;
  while (cursor < range.end) {
    if (svg.startsWith("/*", cursor)) {
      const commentEnd = svg.indexOf("*/", cursor + 2);
      if (commentEnd < 0 || commentEnd >= range.end) {
        scanError(UNSUPPORTED_REFERENCE, "unterminated CSS comment");
      }
      cursor = commentEnd + 2;
      continue;
    }
    const quote = svg.charCodeAt(cursor);
    if (quote === 0x22 || quote === 0x27) {
      cursor += 1;
      while (cursor < range.end && svg.charCodeAt(cursor) !== quote) {
        cursor += svg.charCodeAt(cursor) === 0x5c ? 2 : 1;
        cursor = Math.min(cursor, range.end);
      }
      cursor = Math.min(cursor + 1, range.end);
      continue;
    }
    if (svg.charCodeAt(cursor) !== 0x23) {
      cursor += 1;
      continue;
    }
    const idStart = cursor + 1;
    let idEnd = idStart;
    while (idEnd < range.end) {
      const code = svg.charCodeAt(idEnd);
      if (code === 0x5c && idEnd + 1 < range.end) {
        idEnd += 2;
      } else if (isCssNameCode(code) || code === 0x26 || code === 0x3b) {
        idEnd += 1;
      } else {
        break;
      }
    }
    if (idEnd > idStart) {
      addReference(context, {
        idRange: { start: idStart, end: idEnd },
        rawRange: { start: cursor, end: idEnd },
        encoding: "css-or-smil",
        metadata: { attribute: "style", kind: "css-selector", syntax: "id-selector" },
      });
    }
    cursor = Math.max(idEnd, cursor + 1);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat CSS block scanning must track comments, quotes, braces, and selector preludes.
function scanStyleBody(context: ReferenceScanContext, range: TextRange): void {
  const { svg } = context;
  scanUrlReferences(context, range, "style");
  let cursor = range.start;
  let preludeStart = cursor;
  let depth = 0;
  while (cursor < range.end) {
    if (svg.startsWith("/*", cursor)) {
      const commentEnd = svg.indexOf("*/", cursor + 2);
      if (commentEnd < 0 || commentEnd >= range.end) {
        scanError(UNSUPPORTED_REFERENCE, "unterminated CSS comment");
      }
      cursor = commentEnd + 2;
      continue;
    }
    const quote = svg.charCodeAt(cursor);
    if (quote === 0x22 || quote === 0x27) {
      cursor += 1;
      while (cursor < range.end && svg.charCodeAt(cursor) !== quote) {
        cursor += svg.charCodeAt(cursor) === 0x5c ? 2 : 1;
        cursor = Math.min(cursor, range.end);
      }
      cursor = Math.min(cursor + 1, range.end);
      continue;
    }
    if (svg.charCodeAt(cursor) === 0x7b) {
      if (depth > 0) {
        scanError(UNSUPPORTED_REFERENCE, "nested CSS blocks are unsupported with contentIdPrefix");
      }
      let first = preludeStart;
      while (first < cursor && isXmlSpaceCode(svg.charCodeAt(first))) {
        first += 1;
      }
      if (svg.charCodeAt(first) === 0x40) {
        scanError(UNSUPPORTED_REFERENCE, "CSS block at-rules are unsupported with contentIdPrefix");
      }
      scanCssSelectorHashes(context, { start: preludeStart, end: cursor });
      depth = 1;
    } else if (svg.charCodeAt(cursor) === 0x7d) {
      if (depth === 0) {
        scanError(UNSUPPORTED_REFERENCE, "unbalanced CSS brace");
      }
      depth = 0;
      preludeStart = cursor + 1;
    }
    cursor += 1;
  }
  if (depth !== 0) {
    scanError(UNSUPPORTED_REFERENCE, "unbalanced CSS block");
  }
}

function whitespaceTokens(range: TextRange, svg: string): TextRange[] {
  const tokens: TextRange[] = [];
  let cursor = range.start;
  while (cursor < range.end) {
    while (cursor < range.end && isXmlSpaceCode(svg.charCodeAt(cursor))) {
      cursor += 1;
    }
    const start = cursor;
    while (cursor < range.end && !isXmlSpaceCode(svg.charCodeAt(cursor))) {
      cursor += 1;
    }
    if (cursor > start) {
      tokens.push({ start, end: cursor });
    }
  }
  return tokens;
}

function scanAria(context: ReferenceScanContext, attribute: ScannedAttribute): void {
  const { definitions, svg } = context;
  const tokens = whitespaceTokens(attribute.value, svg);
  const syntax = ARIA_SINGLE.has(attribute.name) ? "single" : "list";
  if (syntax === "single" && tokens.length > 1) {
    const containsKnown = tokens.some((token) =>
      definitions.has(decodeXml(svg.slice(token.start, token.end))),
    );
    if (containsKnown) {
      scanError(UNSUPPORTED_REFERENCE, `${attribute.name} must contain one ID`);
    }
    return;
  }
  for (const token of tokens) {
    addReference(context, {
      idRange: token,
      rawRange: token,
      encoding: "xml",
      metadata: {
        attribute: attribute.name,
        kind: "aria",
        syntax,
      },
    });
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SMIL timing lists require escape and parenthesis state while splitting semicolon items.
function splitSmilItems(range: TextRange, svg: string): TextRange[] {
  const items: TextRange[] = [];
  let cursor = range.start;
  let start = cursor;
  let depth = 0;
  let escaped = false;
  while (cursor <= range.end) {
    const atEnd = cursor === range.end;
    const code = svg.charCodeAt(cursor);
    if (atEnd || (code === 0x3b && depth === 0 && !escaped)) {
      let itemStart = start;
      let itemEnd = cursor;
      while (itemStart < itemEnd && isXmlSpaceCode(svg.charCodeAt(itemStart))) {
        itemStart += 1;
      }
      while (itemEnd > itemStart && isXmlSpaceCode(svg.charCodeAt(itemEnd - 1))) {
        itemEnd -= 1;
      }
      if (itemEnd > itemStart) {
        items.push({ start: itemStart, end: itemEnd });
      }
      start = cursor + 1;
      escaped = false;
      cursor += 1;
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (code === 0x5c) {
      escaped = true;
    } else if (code === 0x28) {
      depth += 1;
    } else if (code === 0x29 && depth > 0) {
      depth -= 1;
    }
    cursor += 1;
  }
  return items;
}

function findUnescaped(svg: string, range: TextRange, wanted: number): number | undefined {
  let escaped = false;
  for (let cursor = range.start; cursor < range.end; cursor += 1) {
    if (escaped) {
      escaped = false;
    } else if (svg.charCodeAt(cursor) === 0x5c) {
      escaped = true;
    } else if (svg.charCodeAt(cursor) === wanted) {
      return cursor;
    }
  }
  return undefined;
}

function localCandidate(svg: string, range: TextRange, definitions: ReadonlySet<string>): boolean {
  try {
    return definitions.has(decodeReference(svg.slice(range.start, range.end), "css-or-smil"));
  } catch (error) {
    if (error instanceof FatalError) {
      return false;
    }
    throw error;
  }
}

function classifySmilSuffix(suffix: string): ScannedEmbeddedSvgReferenceSyntax | undefined {
  if (/^(?:begin|end)(?:\s*[+-]\s*(?:\d|\.)[^\s]*)?$/.test(suffix)) {
    return "syncbase";
  }
  if (/^repeat\(\d+\)(?:\s*[+-]\s*(?:\d|\.)[^\s]*)?$/.test(suffix)) {
    return "repeat";
  }
  if (/^marker\([^)]*\)$/.test(suffix)) {
    return "marker";
  }
  if (/^[A-Za-z_:][A-Za-z0-9_.:]*(?:\s*[+-]\s*(?:\d|\.)[^\s]*)?$/.test(suffix)) {
    return "eventbase";
  }
  return undefined;
}

function scanSmil(context: ReferenceScanContext, attribute: ScannedAttribute): void {
  const { definitions, svg } = context;
  for (const item of splitSmilItems(attribute.value, svg)) {
    const raw = svg.slice(item.start, item.end);
    if (
      /^[+-]?\s*(?:\d|\.)/.test(raw) ||
      raw === "indefinite" ||
      /^(?:wallclock|accesskey)\(/.test(raw)
    ) {
      continue;
    }
    if (raw.startsWith("id(")) {
      const close = raw.indexOf(")", 3);
      if (close < 0) {
        const candidate = { start: item.start + 3, end: item.end };
        if (localCandidate(svg, candidate, definitions)) {
          scanError(UNSUPPORTED_REFERENCE, "unterminated deprecated id()");
        }
        continue;
      }
      const idRange = { start: item.start + 3, end: item.start + close };
      addReference(context, {
        idRange,
        rawRange: item,
        encoding: "css-or-smil",
        metadata: {
          attribute: attribute.name,
          kind: "smil",
          syntax: "deprecated-id",
        },
      });
      continue;
    }
    const separator = findUnescaped(svg, item, 0x2e);
    if (separator === undefined) {
      continue;
    }
    const idRange = { start: item.start, end: separator };
    const syntax = classifySmilSuffix(svg.slice(separator + 1, item.end));
    if (syntax === undefined) {
      if (localCandidate(svg, idRange, definitions)) {
        scanError(UNSUPPORTED_REFERENCE, `unsupported ${attribute.name} item ${raw}`);
      }
      continue;
    }
    addReference(context, {
      idRange,
      rawRange: item,
      encoding: "css-or-smil",
      metadata: {
        attribute: attribute.name,
        kind: "smil",
        syntax,
      },
    });
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dispatch is centralized so every supported SVG reference surface shares one structural scan.
export function scanEmbeddedSvgIds(svg: string): EmbeddedSvgIdScan {
  const scan = scanXml(svg);
  const ids: string[] = [];
  for (const element of scan.elements) {
    for (const attribute of element.attributes) {
      if (attribute.name === "id") {
        const id = decodeXml(svg.slice(attribute.value.start, attribute.value.end));
        if (id.length > 0) {
          ids.push(id);
        }
      }
    }
  }

  const definitions = new Set(ids);
  const references: ScannedEmbeddedSvgReference[] = [];
  const context = { svg, definitions, references };
  for (const element of scan.elements) {
    for (const attribute of element.attributes) {
      if (
        (attribute.name === "href" || attribute.name === "xlink:href") &&
        svg.charCodeAt(attribute.value.start) === 0x23
      ) {
        addReference(context, {
          idRange: { start: attribute.value.start + 1, end: attribute.value.end },
          rawRange: attribute.raw,
          encoding: "xml",
          metadata: {
            attribute: attribute.name,
            kind: attribute.name === "xlink:href" ? "xlink:href" : "href",
            syntax: "fragment",
          },
        });
      }
      if (ARIA_SINGLE.has(attribute.name) || ARIA_LIST.has(attribute.name)) {
        scanAria(context, attribute);
      }
      if (attribute.name === "begin" || attribute.name === "end") {
        scanSmil(context, attribute);
      }
      if (URL_REFERENCE_ATTRIBUTES.has(attribute.name)) {
        scanUrlReferences(context, attribute.value, attribute.name);
      }
    }
  }
  for (const styleBody of scan.styleBodies) {
    scanStyleBody(context, styleBody);
  }
  references.sort((left, right) => left.start - right.start);
  return { ids, references };
}
