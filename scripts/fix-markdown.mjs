import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const markdownlintArgs = [
  "markdownlint-cli2",
  "--fix",
  ".github/**/*.md",
  "docs/**/*.md",
  "src/**/*.md",
  "README.md",
];

const roots = [".github", "docs", "src"];
const standaloneFiles = ["README.md"];

const ignoredPrefixes = [
  "src/core/prompts/",
  "docs/plan/archive/",
  ".github/experiments/",
  ".github/skills/",
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function shouldIgnore(relativePath) {
  const posixPath = toPosix(relativePath);
  return ignoredPrefixes.some((prefix) => posixPath.startsWith(prefix));
}

function collectMarkdownFiles(root) {
  const files = [];

  function visit(currentPath) {
    const relativePath = toPosix(path.relative(process.cwd(), currentPath));
    if (shouldIgnore(relativePath)) {
      return;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(currentPath)) {
        visit(path.join(currentPath, entry));
      }
      return;
    }

    if (stats.isFile() && currentPath.endsWith(".md")) {
      files.push(currentPath);
    }
  }

  visit(path.resolve(root));
  return files;
}

function fixFenceLanguages(content) {
  const hasFinalNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (hasFinalNewline) {
    lines.pop();
  }

  let inFence = false;
  let fenceMarker = "";
  let fenceLength = 0;
  let changed = false;

  const fixedLines = lines.map((line) => {
    const match = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) {
      return line;
    }

    const [, indent, marker, rest] = match;
    const markerChar = marker[0];
    const isPlainFence = rest.trim() === "";

    if (!inFence) {
      inFence = true;
      fenceMarker = markerChar;
      fenceLength = marker.length;

      if (isPlainFence) {
        changed = true;
        return `${indent}${marker}text`;
      }

      return line;
    }

    const closesCurrentFence =
      markerChar === fenceMarker && marker.length >= fenceLength && isPlainFence;
    if (closesCurrentFence) {
      inFence = false;
      fenceMarker = "";
      fenceLength = 0;
    }

    return line;
  });

  return { content: `${fixedLines.join("\n")}\n`, changed: changed || !hasFinalNewline };
}

function fixMarkdownFile(filePath) {
  const original = readFileSync(filePath, "utf8");
  const withoutTrailingSpaces = original
    .replace(/[ \t]+$/gm, "")
    .replace(/\n*$/u, "\n");
  const fixed = fixFenceLanguages(withoutTrailingSpaces);

  if (fixed.content !== original) {
    writeFileSync(filePath, fixed.content, "utf8");
    return true;
  }

  return false;
}

const markdownFiles = [
  ...roots.flatMap((root) => collectMarkdownFiles(root)),
  ...standaloneFiles.map((file) => path.resolve(file)),
].filter((file, index, files) => files.indexOf(file) === index);

const changedFiles = markdownFiles.filter(fixMarkdownFile);

console.log(
  `fix-markdown: normalized ${changedFiles.length} markdown file${
    changedFiles.length === 1 ? "" : "s"
  } before markdownlint --fix.`,
);

const result = spawnSync("npx", ["--no-install", ...markdownlintArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`fix-markdown: failed to run markdownlint-cli2: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
