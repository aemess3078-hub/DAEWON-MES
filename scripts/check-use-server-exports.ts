const fs = require("node:fs") as typeof import("node:fs")
const path = require("node:path") as typeof import("node:path")
const ts = require("typescript") as typeof import("typescript")

interface Violation {
  loc: string
  exportText: string
}

interface CheckResult {
  filePath: string
  violations: Violation[]
}

const root = process.cwd()
const sourceDirs = ["src"]
const excludedDirs = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "test-results",
])
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"])

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (excludedDirs.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
      continue
    }

    if (!entry.isFile()) continue
    if (entry.name.endsWith(".d.ts")) continue
    if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath)
  }

  return files
}

function hasModifier(node: import("typescript").Node, kind: import("typescript").SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false
  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind))
}

function isTypeOnlyStatement(statement: import("typescript").Statement): boolean {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return true
  }

  return ts.isExportDeclaration(statement) && statement.isTypeOnly
}

function hasUseServerDirective(sourceFile: import("typescript").SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteralLike(statement.expression)) {
      if (statement.expression.text === "use server") return true
      continue
    }

    return false
  }

  return false
}

function formatLocation(sourceFile: import("typescript").SourceFile, node: import("typescript").Node): string {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${path.relative(root, sourceFile.fileName)}:${pos.line + 1}:${pos.character + 1}`
}

function describeExport(
  statement: import("typescript").Statement,
  sourceFile: import("typescript").SourceFile,
): string {
  const text = statement.getText(sourceFile).split(/\r?\n/, 1)[0]
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function checkUseServerFile(filePath: string): CheckResult | null {
  const text = fs.readFileSync(filePath, "utf8")
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
  if (!hasUseServerDirective(sourceFile)) return null

  const violations: Violation[] = []

  for (const statement of sourceFile.statements) {
    const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    if (!isExported && !ts.isExportDeclaration(statement)) continue
    if (isTypeOnlyStatement(statement)) continue

    const isAllowed =
      ts.isFunctionDeclaration(statement) &&
      !hasModifier(statement, ts.SyntaxKind.DefaultKeyword) &&
      hasModifier(statement, ts.SyntaxKind.AsyncKeyword)

    if (!isAllowed) {
      violations.push({
        loc: formatLocation(sourceFile, statement),
        exportText: describeExport(statement, sourceFile),
      })
    }
  }

  return { filePath, violations }
}

const files = sourceDirs
  .map((dir) => path.join(root, dir))
  .filter((dir) => fs.existsSync(dir))
  .flatMap(walk)
  .sort()

const checked: string[] = []
const violations: Violation[] = []

for (const file of files) {
  const result = checkUseServerFile(file)
  if (!result) continue

  checked.push(result.filePath)
  violations.push(...result.violations)
}

if (violations.length > 0) {
  console.error(`Found ${violations.length} invalid export(s) in ${checked.length} "use server" file(s).`)
  console.error(
    'Only `export async function ...` is allowed. Move constants, helpers, builders, callbacks, and schemas to non-"use server" modules.',
  )

  for (const violation of violations) {
    console.error(`- ${violation.loc} -> ${violation.exportText}`)
  }

  process.exit(1)
}

console.log(`Checked ${checked.length} "use server" file(s): all exports are async functions.`)
