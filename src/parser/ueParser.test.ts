import { describe, expect, it } from 'vitest'
import { Buffer } from 'buffer'
import { parseClipboardText, parseUObjectText, type ParsedProperty } from './ueParser'

describe('parseUObjectText', () => {
  it('parses objects and properties with raw preservation', () => {
    const input = `Begin Object Class=/Script/NiagaraEditor.NiagaraNodeInput Name="NiagaraNodeInput_1"
  NodePosX=-624
  NodePosY=-96
  PersistentGuid=00000000000000000000000000000000
  Variable=(VarData=(100,0,0,0),Name="Module.ParticleCount")
  CustomProperties Pin (PinId=1234,PinName="Input",Direction="EGPD_Output",PinType.PinCategory="Type")
End Object`
    const objects = parseUObjectText(input)
    expect(objects).toHaveLength(1)
    expect(objects[0].className).toBe('/Script/NiagaraEditor.NiagaraNodeInput')

    const nodePosX = objects[0].properties.NodePosX as ParsedProperty
    expect(nodePosX.normalized).toBe(-624)
    expect(nodePosX.raw).toBe('-624')
    expect(nodePosX.valueKind).toBe('number')

    const nodePosY = objects[0].properties.NodePosY as ParsedProperty
    expect(nodePosY.normalized).toBe(-96)

    const guid = objects[0].properties.PersistentGuid as ParsedProperty
    expect(guid.normalized).toBe('00000000000000000000000000000000')
    expect(guid.valueKind).toBe('string')

    const variable = objects[0].properties.Variable as ParsedProperty
    expect(variable.valueKind).toBe('tuple')
    const variableEntries = variable.normalized as Record<string, ParsedProperty | ParsedProperty[]>
    const nameProp = variableEntries.Name as ParsedProperty
    expect(nameProp.normalized).toBe('Module.ParticleCount')

    const pin = objects[0].properties['CustomProperties Pin'] as ParsedProperty
    expect(pin.valueKind).toBe('tuple')
    const pinEntries = pin.normalized as Record<string, ParsedProperty | ParsedProperty[]>
    const pinId = pinEntries.PinId as ParsedProperty
    expect(pinId.normalized).toBe(1234)
  })
})

describe('parseClipboardText', () => {
  it('decodes ExportedNodes and builds AI graph metadata', () => {
    const exported = `Begin Object Class=/Script/InputBlueprintNodes.K2Node_EnhancedInputAction Name="InputNode"
  NodeGuid=InputNodeGuid
  NodePosX=0
  NodePosY=0
  InputAction="/Script/EnhancedInput.InputAction'IA_Jump'"
  CustomProperties Pin (PinId=1,PinName="Triggered",PinType.PinCategory="exec")
  CustomProperties Pin (PinId=2,PinName="ActionValue",PinType.PinCategory="struct",bAdvancedView=True)
End Object
Begin Object Class=/Script/BlueprintGraph.K2Node_CallFunction Name="NodeA"
  NodeGuid=NodeAId
  NodePosX=20
  NodePosY=20
  CustomProperties Pin (PinId=100,PinName="ExecOut",Direction="EGPD_Output",PinType.PinCategory="exec",LinkedTo=(NodeB 200))
End Object
Begin Object Class=/Script/BlueprintGraph.K2Node_CallFunction Name="NodeB"
  NodeGuid=NodeBId
  NodePosX=200
  NodePosY=200
  CustomProperties Pin (PinId=200,PinName="ExecIn",Direction="EGPD_Input",PinType.PinCategory="exec")
End Object
Begin Object Class=/Script/BlueprintGraph.EdGraphNode_Comment Name="Comment_0"
  NodeGuid=CommentGuid
  NodePosX=-10
  NodePosY=-10
  NodeWidth=100
  NodeHeight=100
  NodeComment="Group"
  CommentColor=(R=1.0,G=1.0,B=1.0,A=1.0)
End Object
`
    const encoded = Buffer.from(exported, 'utf-8').toString('base64')
    const input = `Begin Object Name="Root"
  ExportedNodes="${encoded}"
End Object`
    const result = parseClipboardText(input)
    expect(result.errors).toHaveLength(0)
    expect(result.exportedNodes).toHaveLength(4)

    const inputNode = result.ai.exportedNodes.find((node) => node.name === 'InputNode')
    expect(inputNode?.semantic?.type).toBe('EnhancedInputAction')
    expect((inputNode?.semantic as { inputActionAssetPath?: string })?.inputActionAssetPath).toBe(
      "/Script/EnhancedInput.InputAction'IA_Jump'",
    )

    const triggeredPin = inputNode?.pins.find((pin) => pin.pinName === 'Triggered')
    expect(triggeredPin?.direction).toBe('input')
    expect(triggeredPin?.rawDirection).toBeNull()
    expect(triggeredPin?.directionInferred).toBe(true)

    const actionValueSemantic = (inputNode?.semantic as { outputs?: Record<string, { isAdvanced: boolean }> })
      ?.outputs?.ActionValue
    expect(actionValueSemantic?.isAdvanced).toBe(true)

    const nodeA = result.ai.exportedNodes.find((node) => node.name === 'NodeA')
    const nodeALink = nodeA?.pins.find((pin) => pin.pinName === 'ExecOut')
    expect(nodeALink?.linkedTo).toEqual(['NodeBId:200'])

    const commentGroup = result.ai.commentGroups.find((group) => group.nodeId === 'CommentGuid')
    expect(commentGroup?.containedNodeIds).toEqual(expect.arrayContaining(['InputNodeGuid', 'NodeAId']))
    expect(commentGroup?.containedNodeIds).not.toContain('NodeBId')
  })
})
