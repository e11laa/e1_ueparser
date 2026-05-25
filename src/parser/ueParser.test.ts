import { describe, expect, it } from 'vitest'
import { Buffer } from 'buffer'
import { parseClipboardText, parseUObjectText } from './ueParser'

describe('parseUObjectText', () => {
  it('parses objects and properties', () => {
    const input = `Begin Object Class=/Script/NiagaraEditor.NiagaraNodeInput Name="NiagaraNodeInput_1"
  NodePosX=-624
  NodePosY=-96
  Variable=(VarData=(100,0,0,0),Name="Module.ParticleCount")
  CustomProperties Pin (PinId=1234,PinName="Input",Direction="EGPD_Output",PinType.PinCategory="Type")
End Object`
    const objects = parseUObjectText(input)
    expect(objects).toHaveLength(1)
    expect(objects[0].className).toBe('/Script/NiagaraEditor.NiagaraNodeInput')
    expect(objects[0].properties.NodePosX).toBe(-624)
    expect(objects[0].properties.NodePosY).toBe(-96)
    expect(objects[0].properties.Variable).toMatchObject({
      VarData: [100, 0, 0, 0],
      Name: 'Module.ParticleCount',
    })
    expect(objects[0].properties['CustomProperties Pin']).toMatchObject({
      PinId: 1234,
      PinName: 'Input',
    })
  })
})

describe('parseClipboardText', () => {
  it('decodes ExportedNodes and parses nested objects', () => {
    const exported = `Begin Object Name="TestNode"
  NodePosX=1
End Object
`
    const encoded = Buffer.from(exported, 'utf-8').toString('base64')
    const input = `Begin Object Name="Root"
  ExportedNodes="${encoded}"
End Object`
    const result = parseClipboardText(input)
    expect(result.errors).toHaveLength(0)
    expect(result.exportedNodes).toHaveLength(1)
    expect(result.exportedNodes[0].name).toBe('TestNode')
    expect(result.decodedExportedNodesText).toContain('Begin Object')
  })
})
