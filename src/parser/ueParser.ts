export type ParsedProperty = {
  normalized: unknown
  raw: string
  valueKind:
    | 'string'
    | 'number'
    | 'bool'
    | 'none'
    | 'tuple'
    | 'memberReference'
    | 'textMacro'
    | 'objectRef'
    | 'unknown'
}

export type ParsedUObject = {
  className?: string
  name?: string
  exportPath?: string
  properties: Record<string, ParsedProperty | ParsedProperty[]>
  children?: ParsedUObject[]
  rawHeader?: string
}

type ParseDiagnostics = {
  errors: string[]
  warnings: string[]
}

export type AiUObject = {
  className?: string
  name?: string
  exportPath?: string
  properties: Record<string, unknown>
  children?: AiUObject[]
}

export type AiPin = {
  pinId: string
  pinKey: string
  pinName?: string
  direction: 'input' | 'output'
  rawDirection: string | null
  directionInferred: boolean
  linkedTo: string[]
  pinType?: Record<string, unknown>
  defaultValue?: unknown
  defaultObject?: unknown
  defaultTextValue?: unknown
  isAdvanced: boolean
  isHidden: boolean
}

type PinSemantic = {
  pinId: string
  pinKey: string
  connected: boolean
  isAdvanced: boolean
  isHidden: boolean
}

type EnhancedInputSemantic = {
  type: 'EnhancedInputAction'
  inputActionAssetPath?: string
  outputs: {
    Triggered?: PinSemantic
    Started?: PinSemantic
    Ongoing?: PinSemantic
    Canceled?: PinSemantic
    Completed?: PinSemantic
    ActionValue?: PinSemantic
    ElapsedSeconds?: PinSemantic
    TriggeredSeconds?: PinSemantic
    InputAction?: PinSemantic
  }
}

type PromotableOperatorSemantic = {
  type: 'PromotableOperator'
  operationName?: string
  memberName?: string
  inputA?: PinSemantic
  inputB?: (PinSemantic & { defaultValue?: unknown })
  returnValue?: PinSemantic
}

type NodeSemantic = EnhancedInputSemantic | PromotableOperatorSemantic

export type AiNode = AiUObject & {
  nodeId: string
  pins: AiPin[]
  semantic?: NodeSemantic
}

export type CommentGroup = {
  nodeId: string
  nodeName?: string
  nodeComment?: string
  nodePosX?: number
  nodePosY?: number
  nodeWidth?: number
  nodeHeight?: number
  commentColor?: unknown
  containedNodeIds: string[]
}

export type AiParseResult = {
  objects: AiUObject[]
  exportedNodes: AiNode[]
  commentGroups: CommentGroup[]
}

export type ParseResult = {
  objects: ParsedUObject[]
  exportedNodes: ParsedUObject[]
  ai: AiParseResult
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

  const ai = buildAiResult(objects, exportedNodes)

  return {
    objects,
    exportedNodes,
    ai,
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
    rawHeader: line,
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
    const value = parsePropertyValue(valueText, key)
    assignValue(target.properties, key, value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    diagnostics?.warnings.push(`Property parse failure (${key}): ${message}`)
  }
}

function parsePropertyValue(input: string, key?: string): ParsedProperty {
  const raw = input.trim()
  let value = raw
  if (value.endsWith(',')) {
    value = value.slice(0, -1).trim()
  }

  const forceString = key === 'PersistentGuid'

  if (value.startsWith('(') && value.endsWith(')')) {
    const group = parseGroup(value.slice(1, -1))
    return {
      normalized: group,
      raw,
      valueKind: key === 'MemberReference' ? 'memberReference' : 'tuple',
    }
  }

  if (/^None$/i.test(value)) {
    return { normalized: null, raw, valueKind: 'none' }
  }

  if (isTextMacro(value)) {
    return { normalized: value, raw, valueKind: 'textMacro' }
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    const unescaped = unescapeString(value.slice(1, -1))
    if (isObjectReference(unescaped)) {
      return { normalized: unescaped, raw, valueKind: 'objectRef' }
    }
    return { normalized: unescaped, raw, valueKind: 'string' }
  }

  if (!forceString && /^-?\d+(\.\d+)?$/.test(value)) {
    return { normalized: Number(value), raw, valueKind: 'number' }
  }

  if (!forceString && /^(true|false)$/i.test(value)) {
    return { normalized: value.toLowerCase() === 'true', raw, valueKind: 'bool' }
  }

  if (isObjectReference(value)) {
    return { normalized: value, raw, valueKind: 'objectRef' }
  }

  if (forceString) {
    return { normalized: value, raw, valueKind: 'string' }
  }

  if (key === 'MemberReference') {
    return { normalized: value, raw, valueKind: 'memberReference' }
  }

  return { normalized: value, raw, valueKind: 'unknown' }
}

function parseGroup(input: string): Record<string, ParsedProperty | ParsedProperty[]> | ParsedProperty[] {
  const tokens = splitTopLevel(input, ',')
  const values: ParsedProperty[] = []
  const entries: Record<string, ParsedProperty | ParsedProperty[]> = {}
  let hasKeys = false

  for (const token of tokens) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const eqIndex = indexOfTopLevelEquals(trimmed)
    if (eqIndex >= 0) {
      hasKeys = true
      const key = trimmed.slice(0, eqIndex).trim()
      const value = parsePropertyValue(trimmed.slice(eqIndex + 1).trim(), key)
      assignValue(entries, key, value)
    } else {
      values.push(parsePropertyValue(trimmed))
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

function assignValue<T>(record: Record<string, T | T[]>, key: string, value: T) {
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
    const prop = Array.isArray(value) ? value[0] : value
    if (prop && typeof prop.normalized === 'string') {
      return prop.normalized
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

function buildAiResult(objects: ParsedUObject[], exportedNodes: ParsedUObject[]): AiParseResult {
  const aiObjects = objects.map((obj) => buildAiUObject(obj))
  const aiExportedNodes = buildAiExportedNodes(exportedNodes)
  const commentGroups = buildCommentGroups(aiExportedNodes)
  return { objects: aiObjects, exportedNodes: aiExportedNodes, commentGroups }
}

function buildAiUObject(obj: ParsedUObject): AiUObject {
  return {
    className: obj.className,
    name: obj.name,
    exportPath: obj.exportPath,
    properties: normalizeProperties(obj.properties),
    children: obj.children?.map((child) => buildAiUObject(child)),
  }
}

function buildAiExportedNodes(nodes: ParsedUObject[]): AiNode[] {
  const nodeIdMap = new Map<string, string>()
  for (const node of nodes) {
    const nodeId = getNodeId(node)
    if (node.name) {
      nodeIdMap.set(node.name, nodeId)
    }
  }

  return nodes.map((node) => {
    const nodeId = getNodeId(node)
    const base = buildAiUObject(node)
    const pins = parsePins(node, nodeId, nodeIdMap)
    const aiNode: AiNode = {
      ...base,
      nodeId,
      pins,
    }

    const semantic = extractNodeSemantic(aiNode, node)
    if (semantic) {
      aiNode.semantic = semantic
    }

    return aiNode
  })
}

function normalizeProperties(
  properties: Record<string, ParsedProperty | ParsedProperty[]>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    output[key] = normalizePropertyEntry(value)
  }
  return output
}

function normalizePropertyEntry(value: ParsedProperty | ParsedProperty[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeParsedProperty(item))
  }
  return normalizeParsedProperty(value)
}

function normalizeParsedProperty(property: ParsedProperty): unknown {
  return normalizeParsedValue(property.normalized)
}

function normalizeParsedValue(value: unknown): unknown {
  if (isParsedProperty(value)) {
    return normalizeParsedProperty(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeParsedValue(item))
  }
  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeParsedValue(entry)
    }
    return normalized
  }
  return value
}

function parsePins(node: ParsedUObject, nodeId: string, nodeIdMap: Map<string, string>): AiPin[] {
  const pinProperty = node.properties['CustomProperties Pin']
  if (!pinProperty) return []
  const pinEntries = Array.isArray(pinProperty) ? pinProperty : [pinProperty]
  const pins: AiPin[] = []

  for (const entry of pinEntries) {
    const tuple = getTupleRecord(entry)
    if (!tuple) continue
    const pinIdValue = getEntryProperty(tuple, 'PinId')
    const pinIdRaw = pinIdValue ? normalizeParsedValue(pinIdValue.normalized) : undefined
    const pinId = pinIdRaw !== undefined && pinIdRaw !== null ? String(pinIdRaw) : ''
    if (!pinId) continue

    const pinName = getEntryString(tuple, 'PinName')
    const directionProp = getEntryProperty(tuple, 'Direction')
    const rawDirection = directionProp ? directionProp.raw : null
    const direction = directionProp
      ? normalizeDirection(String(normalizeParsedValue(directionProp.normalized)))
      : 'input'
    const directionInferred = !directionProp

    const linkedTo = parseLinkedTo(tuple, nodeIdMap)
    const pinType = extractPinType(tuple)
    const defaultValue = getEntryNormalized(tuple, 'DefaultValue')
    const defaultObject = getEntryNormalized(tuple, 'DefaultObject')
    const defaultTextValue = getEntryNormalized(tuple, 'DefaultTextValue')
    const isAdvanced = getEntryBoolean(tuple, 'bAdvancedView') ?? false
    const isHidden = getEntryBoolean(tuple, 'bHidden') ?? false

    pins.push({
      pinId,
      pinKey: `${nodeId}:${pinId}`,
      pinName,
      direction,
      rawDirection,
      directionInferred,
      linkedTo,
      pinType,
      defaultValue,
      defaultObject,
      defaultTextValue,
      isAdvanced,
      isHidden,
    })
  }

  return pins
}

function parseLinkedTo(
  tuple: Record<string, ParsedProperty | ParsedProperty[]>,
  nodeIdMap: Map<string, string>,
): string[] {
  const linkedToProp = getEntryProperty(tuple, 'LinkedTo')
  if (!linkedToProp) return []
  const values = extractTupleValues(linkedToProp.normalized)
  const linkedTo: string[] = []

  for (const value of values) {
    const normalized = normalizeParsedValue(value.normalized)
    const text = typeof normalized === 'string' ? normalized : value.raw
    const [nodeName, pinId] = text.trim().split(/\s+/, 2)
    if (!nodeName || !pinId) continue
    const nodeId = nodeIdMap.get(nodeName) ?? nodeName
    linkedTo.push(`${nodeId}:${pinId}`)
  }

  return linkedTo
}

function extractPinType(tuple: Record<string, ParsedProperty | ParsedProperty[]>):
  | Record<string, unknown>
  | undefined {
  const pinType: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(tuple)) {
    if (!key.startsWith('PinType.')) continue
    pinType[key.slice('PinType.'.length)] = normalizePropertyEntry(value)
  }
  return Object.keys(pinType).length > 0 ? pinType : undefined
}

function extractNodeSemantic(aiNode: AiNode, rawNode: ParsedUObject): NodeSemantic | undefined {
  if (aiNode.className === '/Script/InputBlueprintNodes.K2Node_EnhancedInputAction') {
    return extractEnhancedInputSemantic(aiNode, rawNode)
  }
  if (aiNode.className === '/Script/BlueprintGraph.K2Node_PromotableOperator') {
    return extractPromotableOperatorSemantic(aiNode, rawNode)
  }
  return undefined
}

function extractEnhancedInputSemantic(aiNode: AiNode, rawNode: ParsedUObject): EnhancedInputSemantic {
  const outputs = {
    Triggered: findPinSemantic(aiNode, 'Triggered'),
    Started: findPinSemantic(aiNode, 'Started'),
    Ongoing: findPinSemantic(aiNode, 'Ongoing'),
    Canceled: findPinSemantic(aiNode, 'Canceled'),
    Completed: findPinSemantic(aiNode, 'Completed'),
    ActionValue: findPinSemantic(aiNode, 'ActionValue'),
    ElapsedSeconds: findPinSemantic(aiNode, 'ElapsedSeconds'),
    TriggeredSeconds: findPinSemantic(aiNode, 'TriggeredSeconds'),
    InputAction: findPinSemantic(aiNode, 'InputAction'),
  }

  const inputActionAssetPath = resolveInputActionAssetPath(rawNode, aiNode)

  return {
    type: 'EnhancedInputAction',
    inputActionAssetPath,
    outputs,
  }
}

function extractPromotableOperatorSemantic(
  aiNode: AiNode,
  rawNode: ParsedUObject,
): PromotableOperatorSemantic {
  const operationName = asString(getPropertyNormalized(rawNode.properties, 'OperationName'))
  const functionReference = getEntryPropertyFromProperty(rawNode.properties, 'FunctionReference')
  const memberName = functionReference
    ? asString(getTupleEntryNormalized(functionReference, 'MemberName'))
    : undefined

  const inputA = findPinSemantic(aiNode, 'A')
  const inputB = findPinSemantic(aiNode, 'B')
  const returnValue = findPinSemantic(aiNode, 'ReturnValue')

  return {
    type: 'PromotableOperator',
    operationName,
    memberName,
    inputA,
    inputB: inputB
      ? {
          ...inputB,
          defaultValue: findPinDefaultValue(aiNode, 'B'),
        }
      : undefined,
    returnValue,
  }
}

function resolveInputActionAssetPath(rawNode: ParsedUObject, aiNode: AiNode): string | undefined {
  const fromProperty = asString(getPropertyNormalized(rawNode.properties, 'InputAction'))
  if (fromProperty && fromProperty !== 'None') {
    return fromProperty
  }
  const pin = aiNode.pins.find((candidate) => candidate.pinName === 'InputAction')
  const defaultObject = asString(pin?.defaultObject)
  if (defaultObject && defaultObject !== 'None') {
    return defaultObject
  }
  return undefined
}

function findPinSemantic(node: AiNode, pinName: string): PinSemantic | undefined {
  const pin = node.pins.find((candidate) => candidate.pinName === pinName)
  if (!pin) return undefined
  return {
    pinId: pin.pinId,
    pinKey: pin.pinKey,
    connected: pin.linkedTo.length > 0,
    isAdvanced: pin.isAdvanced,
    isHidden: pin.isHidden,
  }
}

function findPinDefaultValue(node: AiNode, pinName: string): unknown {
  const pin = node.pins.find((candidate) => candidate.pinName === pinName)
  return pin?.defaultValue
}

function buildCommentGroups(nodes: AiNode[]): CommentGroup[] {
  const commentGroups: CommentGroup[] = []
  const nonCommentNodes = nodes.filter((node) => !isCommentNode(node))

  for (const node of nodes) {
    if (!isCommentNode(node)) continue
    const nodePosX = asNumber(node.properties.NodePosX)
    const nodePosY = asNumber(node.properties.NodePosY)
    const nodeWidth = asNumber(node.properties.NodeWidth)
    const nodeHeight = asNumber(node.properties.NodeHeight)

    const containedNodeIds: string[] = []
    if (
      nodePosX !== undefined &&
      nodePosY !== undefined &&
      nodeWidth !== undefined &&
      nodeHeight !== undefined
    ) {
      const maxX = nodePosX + nodeWidth
      const maxY = nodePosY + nodeHeight
      for (const candidate of nonCommentNodes) {
        const candidateX = asNumber(candidate.properties.NodePosX)
        const candidateY = asNumber(candidate.properties.NodePosY)
        if (candidateX === undefined || candidateY === undefined) continue
        if (candidateX >= nodePosX && candidateX <= maxX && candidateY >= nodePosY && candidateY <= maxY) {
          containedNodeIds.push(candidate.nodeId)
        }
      }
    }

    commentGroups.push({
      nodeId: node.nodeId,
      nodeName: node.name,
      nodeComment: asString(node.properties.NodeComment),
      nodePosX,
      nodePosY,
      nodeWidth,
      nodeHeight,
      commentColor: node.properties.CommentColor,
      containedNodeIds,
    })
  }

  return commentGroups
}

function isCommentNode(node: AiNode): boolean {
  return node.className?.includes('EdGraphNode_Comment') ?? false
}

function getNodeId(node: ParsedUObject): string {
  const nodeGuid = asString(getPropertyNormalized(node.properties, 'NodeGuid'))
  if (nodeGuid) return nodeGuid
  if (node.name) return node.name
  if (node.exportPath) return node.exportPath
  return 'unknown'
}

function getPropertyNormalized(
  properties: Record<string, ParsedProperty | ParsedProperty[]>,
  key: string,
): unknown {
  const prop = getEntryPropertyFromProperty(properties, key)
  return prop ? normalizeParsedValue(prop.normalized) : undefined
}

function getEntryPropertyFromProperty(
  properties: Record<string, ParsedProperty | ParsedProperty[]>,
  key: string,
): ParsedProperty | undefined {
  const value = properties[key]
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}

function getTupleEntryNormalized(property: ParsedProperty, key: string): unknown {
  const tuple = getTupleRecord(property)
  if (!tuple) return undefined
  const entry = getEntryProperty(tuple, key)
  return entry ? normalizeParsedValue(entry.normalized) : undefined
}

function getTupleRecord(
  property: ParsedProperty,
): Record<string, ParsedProperty | ParsedProperty[]> | undefined {
  if (property.valueKind !== 'tuple' && property.valueKind !== 'memberReference') return undefined
  const normalized = property.normalized
  if (!isRecord(normalized)) return undefined
  if (Array.isArray(normalized)) return undefined
  return normalized as Record<string, ParsedProperty | ParsedProperty[]>
}

function extractTupleValues(value: unknown): ParsedProperty[] {
  if (Array.isArray(value)) {
    return value.filter(isParsedProperty)
  }
  if (isRecord(value)) {
    const tupleValues = value._values
    if (Array.isArray(tupleValues)) {
      return tupleValues.filter(isParsedProperty)
    }
  }
  return []
}

function getEntryProperty(
  tuple: Record<string, ParsedProperty | ParsedProperty[]>,
  key: string,
): ParsedProperty | undefined {
  const value = tuple[key]
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}

function getEntryNormalized(
  tuple: Record<string, ParsedProperty | ParsedProperty[]>,
  key: string,
): unknown {
  const entry = getEntryProperty(tuple, key)
  return entry ? normalizeParsedValue(entry.normalized) : undefined
}

function getEntryString(tuple: Record<string, ParsedProperty | ParsedProperty[]>, key: string): string | undefined {
  return asString(getEntryNormalized(tuple, key))
}

function getEntryBoolean(tuple: Record<string, ParsedProperty | ParsedProperty[]>, key: string): boolean | undefined {
  const value = getEntryNormalized(tuple, key)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return undefined
}

function normalizeDirection(direction: string): 'input' | 'output' {
  const lower = direction.toLowerCase()
  if (lower.includes('output')) return 'output'
  if (lower.includes('input')) return 'input'
  return 'input'
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function isParsedProperty(value: unknown): value is ParsedProperty {
  return (
    typeof value === 'object' &&
    value !== null &&
    'raw' in value &&
    'valueKind' in value &&
    'normalized' in value
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTextMacro(value: string): boolean {
  return value.startsWith('NSLOCTEXT(') || value.startsWith('INVTEXT(')
}

function isObjectReference(value: string): boolean {
  if (value.startsWith('/Script/')) return true
  if (/^[A-Za-z0-9_]+'.*'$/.test(value)) return true
  return false
}
