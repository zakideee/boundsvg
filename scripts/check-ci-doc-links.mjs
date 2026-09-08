/** Check repository-local links in the two prose-only CI entry documents. */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function decodeEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    if (Object.hasOwn(named, entity.toLowerCase())) {
      return named[entity.toLowerCase()];
    }
    return String.fromCodePoint(
      Number.parseInt(
        entity.slice(entity[2].toLowerCase() === "x" ? 3 : 2, -1),
        entity[2].toLowerCase() === "x" ? 16 : 10,
      ),
    );
  });
}

function removeFences(markdown) {
  let fence;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (
          marker?.[0] === fence[0] &&
          marker.length >= fence.length &&
          /^ {0,3}(?:`+|~+)\s*$/.test(line)
        ) {
          fence = undefined;
        }
        return "";
      }
      if (marker) {
        fence = marker;
        return "";
      }
      return line;
    })
    .join("\n");
}

function normalizeReference(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseDestination(text) {
  const trimmed = text.trim();
  const destination = /^(?:<([^<>\n]*)>|(\S+?))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?$/.exec(
    trimmed,
  );
  if (!destination) {
    throw new Error(`Unrecognized link destination: ${trimmed}`);
  }
  return decodeEntities(destination[1] ?? destination[2]);
}

function findClosing(prose, start, pair) {
  let depth = 1;
  for (let index = start + 1; index < prose.length; index += 1) {
    if (prose[index] === "\\") {
      index += 1;
    } else if (prose[index] === pair[0]) {
      depth += 1;
    } else if (prose[index] === pair[1]) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("Unterminated Markdown link");
}

function parseMarkdownLink(prose, start, definitions) {
  const labelEnd = findClosing(prose, start, "[]");
  const label = prose.slice(start + 1, labelEnd);
  if (prose[labelEnd + 1] === "(") {
    const end = findClosing(prose, labelEnd + 1, "()");
    return { end, destination: parseDestination(prose.slice(labelEnd + 2, end)) };
  }
  if (prose[labelEnd + 1] === "[") {
    const end = findClosing(prose, labelEnd + 1, "[]");
    const reference = normalizeReference(prose.slice(labelEnd + 2, end) || label);
    if (!definitions.has(reference)) {
      throw new Error(`Undefined Markdown reference: ${reference}`);
    }
    return { end, destination: definitions.get(reference) };
  }
  return { end: labelEnd, destination: definitions.get(normalizeReference(label)) };
}

/** Extract supported Markdown and HTML links, excluding literal code examples. */
export function extractLinks(markdown) {
  let prose = removeFences(markdown)
    .replace(/(`+)([\s\S]*?)\1/g, "")
    .replace(/<!--([\s\S]*?)-->/g, "");
  const definitions = new Map();
  prose = prose.replace(/^ {0,3}\[([^\]\n]+)\]:\s*(.+)$/gm, (_line, label, destination) => {
    definitions.set(normalizeReference(label), parseDestination(destination));
    return "";
  });
  const links = [];
  const addLink = (destination, offset) =>
    links.push({ destination, line: prose.slice(0, offset).split("\n").length });
  for (const match of prose.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    addLink(decodeEntities(match[1] ?? match[2] ?? match[3]), match.index);
  }
  for (let index = 0; index < prose.length; index += 1) {
    if (prose[index] !== "[" || prose[index - 1] === "\\") {
      continue;
    }
    const parsed = parseMarkdownLink(prose, index, definitions);
    if (parsed.destination !== undefined) {
      addLink(parsed.destination, index);
    }
    index = parsed.end;
  }
  return links;
}

/** Resolve Markdown heading slugs and explicit HTML anchors without executing markup. */
export function collectAnchors(markdown) {
  const prose = removeFences(markdown);
  const anchors = new Set();
  const slugs = new Set();
  const headings = [];
  const lines = prose.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const atx = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index]);
    if (atx) {
      headings.push(atx[1]);
    } else if (
      index + 1 < lines.length &&
      /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1]) &&
      lines[index].trim()
    ) {
      headings.push(lines[index]);
    }
  }
  for (const heading of headings) {
    const text = decodeEntities(
      heading.replace(/<[^>]*>/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"),
    );
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, "")
      .replace(/\s/g, "-");
    let slug = base;
    let suffix = 0;
    while (slugs.has(slug)) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }
    slugs.add(slug);
    anchors.add(slug);
  }
  for (const match of prose.matchAll(
    /<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>/gi,
  )) {
    anchors.add(decodeEntities(match[1]));
  }
  return anchors;
}

function resolveTrackedTarget(repository, document, destination) {
  if (/^[a-z][a-z\d+.-]*:/i.test(destination)) {
    throw new Error("Unsupported URL scheme");
  }
  const [pathAndQuery, ...fragments] = destination.split("#");
  const path = decodeURIComponent(pathAndQuery.split("?")[0]);
  const fragment = decodeURIComponent(fragments.join("#"));
  const target = path
    ? resolve(repository.root, document, "..", path)
    : resolve(repository.root, document);
  const targetRelative = relative(repository.root, target).split(sep).join("/");
  if (targetRelative === ".." || targetRelative.startsWith("../") || path.startsWith("/")) {
    throw new Error("Link escapes repository");
  }
  if (
    !repository.tracked.has(targetRelative) &&
    ![...repository.tracked].some((name) => name.startsWith(`${targetRelative}/`))
  ) {
    throw new Error("Link target is not tracked");
  }
  const resolvedRelative = relative(repository.root, realpathSync(target));
  if (resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`)) {
    throw new Error("Link follows a symlink outside repository");
  }
  return { target, fragment };
}

function checkLink(repository, document, link) {
  const context = `${document}:${link.line}`;
  const checked = { context, destination: link.destination };
  try {
    if (/^(?:https?:|mailto:|\/\/)/i.test(link.destination)) {
      return { notChecked: { ...checked, reason: "external" } };
    }
    const { target, fragment } = resolveTrackedTarget(repository, document, link.destination);
    const isMarkdown = !statSync(target).isDirectory() && extname(target).toLowerCase() === ".md";
    if (fragment && isMarkdown && !collectAnchors(readFileSync(target, "utf8")).has(fragment)) {
      throw new Error(`Missing Markdown anchor: ${fragment}`);
    }
    return {
      checked,
      ...(fragment && !isMarkdown
        ? { notChecked: { ...checked, reason: "non-Markdown fragment" } }
        : {}),
    };
  } catch (error) {
    return { error: `${context}: ${link.destination}: ${error.message}` };
  }
}

/** Check tracked local destinations; report external and non-Markdown fragments separately. */
export function checkDocumentLinks(repoRoot, documents = ["README.md", "CONTRIBUTING.md"]) {
  const listing = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  if (listing.error || listing.status !== 0) {
    throw new Error("Cannot read tracked link targets");
  }
  const repository = {
    root: realpathSync(repoRoot),
    tracked: new Set(listing.stdout.split("\0").filter(Boolean)),
  };
  const report = { checked: [], notChecked: [], errors: [] };
  for (const document of documents) {
    try {
      const markdown = readFileSync(resolve(repository.root, document), "utf8");
      for (const link of extractLinks(markdown)) {
        const checkedLink = checkLink(repository, document, link);
        if (checkedLink.error) {
          report.errors.push(checkedLink.error);
        }
        if (checkedLink.checked) {
          report.checked.push(checkedLink.checked);
        }
        if (checkedLink.notChecked) {
          report.notChecked.push(checkedLink.notChecked);
        }
      }
    } catch (error) {
      report.errors.push(`${document}: ${error.message}`);
    }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = checkDocumentLinks(process.cwd());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.errors.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
