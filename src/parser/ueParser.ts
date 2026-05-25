export type ParsedUObject = {
  className?: string
  name?: string
  exportPath?: string
  properties: Record<string, unknown>
  children?: ParsedUObject[]
}

type ParseDiagnostics = {
  errors: string[]
  warnings: string[]
}

export type ParseResult = {
  objects: ParsedUObject[]
  exportedNodes: ParsedUObject[]
  decodedExportedNodesText?: string
  errors: string[]
  warnings: string[]
  summaryMarkdown: string
}

export function parseClipboardText(input: string): ParseResult {
  const diagnostics: ParseDiagnostics = { errors: [], warnings: [] }
  const objects = parseUObjectText(input, diagnostics)
  const exportedNodesValue = findExportedNodes(objects)
  let exportedNodes: ParsedUObject[] = []
  let decodedExportedNodesText: string | undefined

  if (typeof exportedNodesValue === 'string') {
    const decoded = decodeBase64(exportedNodesValue)
    if (decoded.error) {
      diagnostics.errors.push(`Base64 decode failed: ${decoded.error}`)
    } else if (decoded.value) {
      decodedExportedNodesText = decoded.value
      const exportedDiagnostics: ParseDiagnostics = { errors: [], warnings: [] }
      exportedNodes = parseUObjectText(decoded.value, exportedDiagnostics)
      diagnostics.errors.push(
        ...exportedDiagnostics.errors.map((error) => `ExportedNodes: ${error}`),
      )
      diagnostics.warnings.push(
        ...exportedDiagnostics.warnings.map((warning) => `ExportedNodes: ${warning}`),
      )
    }
  } else if (exportedNodesValue) {
    diagnostics.warnings.push('ExportedNodes is not a string value.')
  } else if (input.trim().length > 0) {
    diagnostics.warnings.push('No ExportedNodes found.')
  }

  return {
    objects,
    exportedNodes,
    decodedExportedNodesText,
    errors: diagnostics.errors,
    warnings: diagnostics.warnings,
    summaryMarkdown: buildSummaryMarkdown(objects, exportedNodes),
  }
}

export function parseUObjectText(input: string, diagnostics?: ParseDiagnostics): ParsedUObject[] {
  const objects: ParsedUObject[] = []
  const stack: ParsedUObject[] = []
  const lines = input.split(/\r?\n/)
  let hasBegin = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('Begin Object')) {
      hasBegin = true
      const obj = parseBeginObjectLine(trimmed)
      objects.push(obj)
      if (stack.length > 0) {
        const parent = stack[stack.length - 1]
        parent.children ??= []
        parent.children.push(obj)
      }
      stack.push(obj)
      continue
    }

    if (trimmed.startsWith('End Object')) {
      if (stack.length === 0) {
        diagnostics?.errors.push('End Object without matching Begin Object.')
      } else {
        stack.pop()
      }
      continue
    }

    if (stack.length === 0) {
      diagnostics?.warnings.push(`Ignored line outside object: ${trimmed}`)
      continue
    }

    parsePropertyLine(trimmed, stack[stack.length - 1], diagnostics)
  }

  if (!hasBegin && input.trim().length > 0) {
    diagnostics?.errors.push('Unsupported format: no Begin Object found.')
  }

  if (stack.length > 0) {
    diagnostics?.errors.push(`Begin/End Object mismatch: ${stack.length} unclosed object(s).`)
  }

  return objects
}

function parseBeginObjectLine(line: string): ParsedUObject {
  const attributes: Record<string, string> = {}
  const matches = line.replace(/^Begin Object\s*/, '').matchAll(/(\w+)=(".*?"|[^\s]+)/g)
  for (const match of matches) {
    const key = match[1]
    const value = unquote(match[2])
    attributes[key] = value
  }

  return {
    className: attributes.Class,
    name: attributes.Name,
    exportPath: attributes.ExportPath,
    properties: {},
  }
}

function parsePropertyLine(
  line: string,
  target: ParsedUObject,
  diagnostics?: ParseDiagnostics,
): void {
  const eqIndex = indexOfTopLevelEquals(line)
  let key: string | null = null
  let valueText: string | null = null

  if (eqIndex >= 0) {
    key = line.slice(0, eqIndex).trim()
    valueText = line.slice(eqIndex + 1).trim()
  } else {
    const parenIndex = line.indexOf('(')
    if (parenIndex > 0 && line.endsWith(')')) {
      key = line.slice(0, parenIndex).trim()
      valueText = line.slice(parenIndex).trim()
    }
  }

  if (!key || valueText === null) {
    diagnostics?.warnings.push(`Unsupported property format: ${line}`)
    return
  }

  try {
    const value = parseValue(valueText)
    assignValue(target.properties, key, value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    diagnostics?.warnings.push(`Property parse failure (${key}): ${message}`)
  }
}

function parseValue(input: string): unknown {
  let value = input.trim()
  if (value.endsWith(',')) {
    value = value.slice(0, -1).trim()
  }

  if (value.startsWith('(') && value.endsWith(')')) {
    return parseGroup(value.slice(1, -1))
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return unescapeString(value.slice(1, -1))
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }

  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true'
  }

  return value
}

function parseGroup(input: string): unknown {
  const tokens = splitTopLevel(input, ',')
  const values: unknown[] = []
  const entries: Record<string, unknown> = {}
  let hasKeys = false

  for (const token of tokens) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const eqIndex = indexOfTopLevelEquals(trimmed)
    if (eqIndex >= 0) {
      hasKeys = true
      const key = trimmed.slice(0, eqIndex).trim()
      const value = parseValue(trimmed.slice(eqIndex + 1).trim())
      assignValue(entries, key, value)
    } else {
      values.push(parseValue(trimmed))
    }
  }

  if (!hasKeys) {
    return values
  }

  if (values.length > 0) {
    entries._values = values
  }

  return entries
}

function assignValue(record: Record<string, unknown>, key: string, value: unknown) {
  const existing = record[key]
  if (existing === undefined) {
    record[key] = value
  } else if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    record[key] = [existing, value]
  }
}

function splitTopLevel(input: string, delimiter: string): string[] {
  const tokens: string[] = []
  let current = ''
  let depth = 0
  let inQuotes = false
  let escapeNext = false

  for (const char of input) {
    if (inQuotes) {
      current += char
      if (escapeNext) {
        escapeNext = false
      } else if (char === '\\') {
        escapeNext = true
      } else if (char === '"') {
        inQuotes = false
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      current += char
      continue
    }

    if (char === '(') {
      depth += 1
      current += char
      continue
    }

    if (char === ')' && depth > 0) {
      depth -= 1
      current += char
      continue
    }

    if (char === delimiter && depth === 0) {
      tokens.push(current)
      current = ''
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function indexOfTopLevelEquals(input: string): number {
  let depth = 0
  let inQuotes = false
  let escapeNext = false

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (inQuotes) {
      if (escapeNext) {
        escapeNext = false
        continue
      }
      if (char === '\\') {
        escapeNext = true
      } else if (char === '"') {
        inQuotes = false
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === '(') {
      depth += 1
      continue
    }

    if (char === ')' && depth > 0) {
      depth -= 1
      continue
    }

    if (char === '=' && depth === 0) {
      return i
    }
  }

  return -1
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return unescapeString(value.slice(1, -1))
  }
  return value
}

function unescapeString(value: string): string {
  return value.replace(/\\(["\\])/g, '$1')
}

function decodeBase64(input: string): { value?: string; error?: string } {
  const normalized = input.replace(/\s+/g, '')
  try {
    if (typeof atob === 'function') {
      return { value: atob(normalized) }
    }
    if (typeof Buffer !== 'undefined') {
      return { value: Buffer.from(normalized, 'base64').toString('utf-8') }
    }
    throw new Error('No base64 decoder available.')
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function findExportedNodes(objects: ParsedUObject[]): string | undefined {
  for (const obj of objects) {
    const value = obj.properties.ExportedNodes
    if (typeof value === 'string') {
      return value
    }
    if (obj.children) {
      const nested = findExportedNodes(obj.children)
      if (nested) return nested
    }
  }
  return undefined
}

function buildSummaryMarkdown(objects: ParsedUObject[], exportedNodes: ParsedUObject[]): string {
  const classCounts = new Map<string, number>()
  for (const obj of objects) {
    const key = obj.className ?? 'Unknown'
    classCounts.set(key, (classCounts.get(key) ?? 0) + 1)
  }
  const nodeCounts = new Map<string, number>()
  for (const node of exportedNodes) {
    const key = node.className ?? 'Unknown'
    nodeCounts.set(key, (nodeCounts.get(key) ?? 0) + 1)
  }

  const lines = ['# Clipboard Summary', '', `- Objects: ${objects.length}`]
  if (classCounts.size > 0) {
    lines.push('', '## Object Classes')
    for (const [key, count] of [...classCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${key}: ${count}`)
    }
  }

  if (exportedNodes.length > 0) {
    lines.push('', `## Exported Nodes (${exportedNodes.length})`)
    for (const [key, count] of [...nodeCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${key}: ${count}`)
    }
  } else {
    lines.push('', '## Exported Nodes', '- None')
  }

  return lines.join('\n')
}
