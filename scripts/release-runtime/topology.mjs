import { posix } from "node:path";
import { compareCanonicalStrings, deepEqualCanonical } from "./canonical.mjs";
import { failRelease } from "./errors.mjs";

const workspacePathPattern =
  /^(?!\*$)(?:(?!\.{1,2}(?:\/|$))[\w.@-]+\/)*(?:(?!\.{1,2}$)[\w.@-]+|\*)$/;
const compareNames = (left, right) => compareCanonicalStrings(left.name, right.name);
const requireSyntax = (condition, code) =>
  condition || failRelease(code, "workspace topology uses unsupported syntax");
export function parsePnpmWorkspacePatterns(source) {
  const declarations = [...source.matchAll(/^packages\s*:(.*)$/gm)];
  requireSyntax(
    declarations.length === 1 && declarations[0][1].trim() === "",
    "WORKSPACE_SYNTAX_INVALID",
  );
  const tail = source.slice(declarations[0].index + declarations[0][0].length);
  const block = tail.split(/\r?\n(?=(?!#)\S)/, 1)[0];
  const itemPattern = /^ {2}- (["'])([^"'\\]+)\1[ \t]*$/gm;
  const patterns = [...block.matchAll(itemPattern)].map((item) => item[2]);
  const residue = block.replace(itemPattern, "").replace(/^[ \t]*(?:#.*)?$/gm, "");
  requireSyntax(
    residue.trim() === "" &&
      patterns.length > 0 &&
      patterns.every((pattern) => workspacePathPattern.test(pattern)) &&
      new Set(patterns).size === patterns.length,
    "WORKSPACE_SYNTAX_INVALID",
  );
  return patterns;
}
export function pnpmPatternMatchesManifest(pattern, manifestPath) {
  const directory = posix.dirname(manifestPath);
  if (!pattern.endsWith("/*")) {
    return directory === pattern;
  }
  const prefix = `${pattern.slice(0, -2)}/`;
  return directory.startsWith(prefix) && !directory.slice(prefix.length).includes("/");
}
function cargoSection(source, name, code) {
  const expression = new RegExp(
    `^\\[${name}\\][ \\t]*(?:#.*)?\\r?\\n([\\s\\S]*?)(?=^[ \\t]*\\[|(?![\\s\\S]))`,
    "gm",
  );
  const sections = [...source.matchAll(expression)];
  requireSyntax(sections.length === 1, code);
  return sections[0][1];
}
export function parseCargoWorkspaceMembers(source) {
  const workspace = cargoSection(source, "workspace", "CARGO_WORKSPACE_INVALID");
  const assignments = [...workspace.matchAll(/^[ \t]*members[ \t]*=/gm)];
  const assignment = /^[ \t]*members[ \t]*=[ \t]*(\[[^\]]*\])[ \t]*(?:#.*)?$/m.exec(workspace);
  requireSyntax(assignments.length === 1 && assignment !== null, "CARGO_WORKSPACE_INVALID");
  const memberPattern = /(["'])([^"'\\\r\n]+)\1/g;
  const members = [...assignment[1].matchAll(memberPattern)].map((match) => match[2]);
  const skeleton = assignment[1].replace(memberPattern, "x");
  requireSyntax(
    /^\[\s*(?:x\s*(?:,\s*x\s*)*,?\s*)?\]$/.test(skeleton) &&
      members.length > 0 &&
      members.every((member) => workspacePathPattern.test(member) && !member.endsWith("/*")) &&
      new Set(members).size === members.length,
    "CARGO_WORKSPACE_INVALID",
  );
  return members;
}
export function projectNpmTopology(manifests, changesetConfig) {
  const publishSet = manifests
    .flatMap(({ path: manifestPath, value }) => {
      requireSyntax(
        typeof value?.name === "string" && value.name.length > 0,
        "TOPOLOGY_MANIFEST_INVALID",
      );
      return value.private !== true && value.publishConfig?.access === "public"
        ? [{ name: value.name, path: posix.dirname(manifestPath) }]
        : [];
    })
    .sort(compareNames);
  const fixed = changesetConfig.fixed;
  requireSyntax(
    Array.isArray(fixed) &&
      fixed.length === 1 &&
      Array.isArray(fixed[0]) &&
      deepEqualCanonical(publishSet.map(({ name }) => name).sort(), [...fixed[0]].sort()),
    "CONTROL_FIXED_GROUP_INVALID",
  );
  return { manifests, publishSet };
}
function cargoIdentity(name, manifestPath, publish) {
  return { name, path: posix.dirname(manifestPath), publish };
}
function projectCargoManifest(source, manifestPath) {
  const section = cargoSection(source, "package", "CONTROL_CARGO_MANIFEST_INVALID");
  const nameAssignments = [...section.matchAll(/^[ \t]*name[ \t]*=/gm)];
  const name = /^name = (["'])([^"'\\\r\n]+)\1$/m.exec(section)?.[2];
  const publishAssignments = [...section.matchAll(/^[ \t]*publish[ \t]*=/gm)];
  const privatePublish = /^publish = (?:false|\[\])$/m.test(section);
  requireSyntax(
    nameAssignments.length === 1 &&
      name !== undefined &&
      publishAssignments.length <= 1 &&
      (publishAssignments.length === 0 || privatePublish),
    "CONTROL_CARGO_MANIFEST_INVALID",
  );
  return cargoIdentity(name, manifestPath, publishAssignments.length === 0);
}
export function assertCargoMetadataTopology(projected, metadataPackages) {
  const metadataTopology = metadataPackages
    .map(({ manifestPath, name, publish }) =>
      cargoIdentity(name, manifestPath, !Array.isArray(publish) || publish.length > 0),
    )
    .sort(compareNames);
  requireSyntax(
    deepEqualCanonical(projected, metadataTopology),
    "CARGO_WORKSPACE_METADATA_MISMATCH",
  );
}
export function projectCargoTopology(rootManifest, readManifest) {
  return parseCargoWorkspaceMembers(rootManifest)
    .map((member) =>
      projectCargoManifest(readManifest(`${member}/Cargo.toml`), `${member}/Cargo.toml`),
    )
    .sort(compareNames);
}
