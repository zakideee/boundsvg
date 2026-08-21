import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { AnimationSpec, VNode } from "@boundsvg/core";
import ts from "typescript";
import { DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS } from "../../playground-shared/animation-playground.ts";
import { LAYOUT_REACTIVE_PRESETS } from "../src/pages/animation/layout-reactive-presets.ts";

const EXPECTED_WHITESPACE_LINES = [
  " RUNS  packages/core",
  " ✓ typing-ime.test.ts   312ms",
  " ✓ text-on-path.test.ts 268ms",
  " PASS  2 suites  in 2.4s",
] as const;

function walkVNodes(node: VNode): VNode[] {
  const nodes = [node];
  for (const child of node.children) {
    if (typeof child !== "string") {
      nodes.push(...walkVNodes(child));
    }
  }
  return nodes;
}

function collectText(node: VNode): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : collectText(child)))
    .join("");
}

function isOpacityKeyframeAnimation(value: unknown): value is AnimationSpec {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const animation = value as Partial<AnimationSpec>;
  return (
    animation.easing === "step-end" &&
    animation.iterations === "infinite" &&
    animation.fill === "both" &&
    Array.isArray(animation.keyframes) &&
    animation.keyframes.length > 0 &&
    animation.keyframes.every(
      (keyframe) => keyframe.opacity !== undefined && keyframe.transform === undefined,
    )
  );
}

function assertRevealKeyframes(animation: AnimationSpec): void {
  const keyframes = animation.keyframes;
  const firstVisible = keyframes.find((keyframe) => keyframe.opacity === 1);
  assert.ok(firstVisible, "reveal animation must contain a visible keyframe");
  if (firstVisible.at > 0) {
    assert.deepEqual(keyframes[0], { at: 0, opacity: 0 });
  }
  const closingKeyframe = keyframes.find(
    (keyframe, index) => index > 0 && keyframe.at < 1 && keyframe.opacity === 0,
  );
  assert.deepEqual(keyframes.at(-1), {
    at: 1,
    opacity: closingKeyframe ? 0 : 1,
  });
}

function assertTerminalAnimationInvariants(scene: VNode, sourceName: string): void {
  const nodes = walkVNodes(scene);
  const textNodes = nodes.filter((node) => node.type === "Text");
  const whitespaceLines = new Map(
    textNodes
      .filter((node) => Reflect.get(node.props, "whiteSpace") === "pre-wrap")
      .map((node) => [collectText(node), node]),
  );
  for (const expectedLine of EXPECTED_WHITESPACE_LINES) {
    const lineNode = whitespaceLines.get(expectedLine);
    assert.ok(lineNode, `${sourceName} must preserve ${JSON.stringify(expectedLine)}`);
    assert.equal(Reflect.get(lineNode.props, "wrap"), "none");
  }

  const revealAnimations = nodes
    .map((node) => Reflect.get(node.props, "animate"))
    .filter(isOpacityKeyframeAnimation);
  assert.ok(revealAnimations.length > 4, `${sourceName} must retain opacity reveal windows`);
  assert.ok(
    revealAnimations.some((animation) =>
      animation.keyframes.some(
        (keyframe, index) => index > 0 && keyframe.at < 1 && keyframe.opacity === 0,
      ),
    ),
    `${sourceName} must retain a closing progress-cell window`,
  );
  assert.ok(
    revealAnimations.some((animation) => animation.keyframes.at(-1)?.opacity === 1),
    `${sourceName} must retain a persistent reveal`,
  );
  for (const animation of revealAnimations) {
    assertRevealKeyframes(animation);
  }
}

function propertyByName(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.PropertyAssignment | undefined {
  return objectLiteral.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText() === propertyName,
  );
}

function stringLiteralValue(expression: ts.Expression): string | undefined {
  let unwrapped = expression;
  while (ts.isAsExpression(unwrapped)) {
    unwrapped = unwrapped.expression;
  }
  return ts.isStringLiteral(unwrapped) ? unwrapped.text : undefined;
}

function findReadmeTerminalBuild(
  sourceFile: ts.SourceFile,
): ts.ArrowFunction | ts.FunctionExpression {
  let terminalBuild: ts.ArrowFunction | ts.FunctionExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (terminalBuild) {
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const id = propertyByName(node, "id");
      const build = propertyByName(node, "build");
      if (
        id &&
        stringLiteralValue(id.initializer) === "terminal-typing" &&
        build &&
        (ts.isArrowFunction(build.initializer) || ts.isFunctionExpression(build.initializer))
      ) {
        terminalBuild = build.initializer;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(terminalBuild, "README terminal build function must exist");
  return terminalBuild;
}

function findArrowVariable(
  root: ts.Node,
  variableName: string,
): ts.ArrowFunction | ts.FunctionExpression {
  let initializer: ts.ArrowFunction | ts.FunctionExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (initializer) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(initializer, `README terminal ${variableName} helper must exist`);
  return initializer;
}

function normalizedNodeText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replaceAll(/\s+/gu, "");
}

function assertReadmeTerminalSourceInvariants(): void {
  const sourcePath = resolve(import.meta.dirname, "../../docs/scripts/generate-examples.ts");
  const sourceText = readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const terminalBuild = findReadmeTerminalBuild(sourceFile);
  const reveal = findArrowVariable(terminalBuild, "reveal");
  const line = findArrowVariable(terminalBuild, "line");

  const pushedKeyframes: string[] = [];
  let revealReturn: ts.ObjectLiteralExpression | undefined;
  const visitReveal = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      pushedKeyframes.push(normalizedNodeText(node.arguments[0], sourceFile));
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isObjectLiteralExpression(node.expression)
    ) {
      revealReturn = node.expression;
    }
    ts.forEachChild(node, visitReveal);
  };
  visitReveal(reveal);
  assert.deepEqual(pushedKeyframes, [
    "{at:0,opacity:0}",
    "{at:from,opacity:1}",
    "{at:to,opacity:0}",
    "{at:1,opacity:closing?0:1}",
  ]);
  assert.ok(revealReturn, "README terminal reveal return must exist");
  assert.equal(stringLiteralValue(propertyByName(revealReturn, "easing")!.initializer), "step-end");
  assert.equal(
    stringLiteralValue(propertyByName(revealReturn, "iterations")!.initializer),
    "infinite",
  );
  assert.equal(stringLiteralValue(propertyByName(revealReturn, "fill")!.initializer), "both");

  let lineProps: ts.ObjectLiteralExpression | undefined;
  const visitLine = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Text" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      lineProps = node.arguments[0];
    }
    ts.forEachChild(node, visitLine);
  };
  visitLine(line);
  assert.ok(lineProps, "README terminal line props must exist");
  assert.equal(
    stringLiteralValue(propertyByName(lineProps, "whiteSpace")!.initializer),
    "pre-wrap",
  );
  assert.equal(stringLiteralValue(propertyByName(lineProps, "wrap")!.initializer), "none");

  const readmeLines: string[] = [];
  const visitLineCalls = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "line" &&
      node.arguments[1] &&
      ts.isArrayLiteralExpression(node.arguments[1])
    ) {
      const text = node.arguments[1].elements
        .filter(ts.isObjectLiteralExpression)
        .map((segment) => propertyByName(segment, "text"))
        .map((textProperty) =>
          textProperty ? stringLiteralValue(textProperty.initializer) : undefined,
        )
        .filter((value): value is string => value !== undefined)
        .join("");
      readmeLines.push(text);
    }
    ts.forEachChild(node, visitLineCalls);
  };
  visitLineCalls(terminalBuild);
  for (const expectedLine of EXPECTED_WHITESPACE_LINES) {
    assert.ok(readmeLines.includes(expectedLine), `README source must preserve ${expectedLine}`);
  }

  const readmeSvg = readFileSync(
    resolve(import.meta.dirname, "../../../fixtures/generated/terminal-typing.svg"),
    "utf8",
  );
  for (const expectedLine of EXPECTED_WHITESPACE_LINES) {
    assert.ok(
      readmeSvg.includes(`data-boundsvg-text="${expectedLine}"`),
      `README SVG must preserve ${expectedLine}`,
    );
  }
}

test("playground and README terminals retain their shared whitespace and reveal invariants", () => {
  const terminalPreset = LAYOUT_REACTIVE_PRESETS["terminal-typing"];
  const playgroundScene = terminalPreset.createFrameGenerator({
    ...DEFAULT_LAYOUT_REACTIVE_PLAYGROUND_CONTROLS,
  })(0).rigidScene;

  assertTerminalAnimationInvariants(playgroundScene, "playground terminal");
  assertReadmeTerminalSourceInvariants();
});
