import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { parseClipboardText } from './parser/ueParser'

type TabKey = 'ai' | 'raw' | 'exported' | 'markdown'

const SAMPLE_CLIPBOARD_TEXT = `Begin Object Class=/Script/NiagaraEditor.NiagaraClipboardContent Name="NiagaraClipboardContent_0"
   ScriptVariables(0)=(ScriptVariable="/Script/NiagaraEditor.NiagaraScriptVariable'NiagaraScriptVariable_2'",OriginalChangeId=55E2B4E2)
   ExportedNodes="QmVnaW4gT2JqZWN0IENsYXNzPS9TY3JpcHQvTmlhZ2FyYUVkaXRvci5OaWFnYXJhTm9kZUlucHV0IE5hbWU9Ik5pYWdhcmFOb2RlSW5wdXRfMSIKICAgTm9kZVBvc1g9MTAKICAgTm9kZVBvc1k9LTIwCiAgIE5vZGVHdWlkPTEyMzQtNTY3OAogICBDdXN0b21Qcm9wZXJ0aWVzIFBpbiAoUGluSWQ9MTIzNCxQaW5OYW1lPSJJbnB1dCIsRGlyZWN0aW9uPSJFR1BEX09VVFBVVCIsUGluVHlwZS5QaW5DYXRlZ29yeT0iVHlwZSIpCkVuZCBPYmplY3Q="
End Object
`

const TAB_LABELS: Record<TabKey, string> = {
  ai: 'AI JSON',
  raw: 'Raw JSON',
  exported: 'Decoded ExportedNodes',
  markdown: 'Markdown Summary',
}

function App() {
  const [inputText, setInputText] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('ai')
  const [result, setResult] = useState(() => parseClipboardText(''))
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const outputs = useMemo(() => {
    const aiJson = JSON.stringify(
      {
        summary: result.summaryMarkdown,
        objects: result.ai.objects,
        exportedNodes: result.ai.exportedNodes,
        commentGroups: result.ai.commentGroups,
      },
      null,
      2,
    )
    const rawJson = JSON.stringify(result.objects, null, 2)
    const decodedOutput = result.decodedExportedNodesText
      ? `Decoded Text:\n${result.decodedExportedNodesText.trim()}\n\nParsed JSON:\n${JSON.stringify(
          result.exportedNodes,
          null,
          2,
        )}`
      : 'No ExportedNodes found.'
    return {
      ai: aiJson,
      raw: rawJson,
      exported: decodedOutput,
      markdown: result.summaryMarkdown,
    }
  }, [result])

  const outputText = outputs[activeTab]

  const handleParse = () => {
    setResult(parseClipboardText(inputText))
  }

  const handleClear = () => {
    setInputText('')
    setResult(parseClipboardText(''))
  }

  const handleLoadSample = () => {
    setInputText(SAMPLE_CLIPBOARD_TEXT)
    setActiveTab('ai')
  }

  const handleCopy = async () => {
    if (!outputText) return
    await navigator.clipboard.writeText(outputText)
  }

  const handleDownload = () => {
    const blob = new Blob([outputs.ai], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'niagara-clipboard.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleFileClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setInputText(text)
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Unreal Engine 5 / Niagara / Blueprint</p>
          <h1>Clipboard JSON Parser</h1>
          <p className="subtitle">Paste UE clipboard text and parse structured JSON in-browser.</p>
        </div>
        <div className="actions">
          <button type="button" onClick={handleParse}>
            Parse
          </button>
          <button type="button" className="ghost" onClick={handleClear}>
            Clear
          </button>
          <button type="button" className="ghost" onClick={handleLoadSample}>
            Load Sample
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="toolbar-group">
          <button type="button" className="ghost" onClick={handleCopy} disabled={!outputText}>
            Copy JSON
          </button>
          <button type="button" className="ghost" onClick={handleDownload} disabled={!result.objects.length}>
            Download JSON
          </button>
        </div>
        <div className="toolbar-group">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            onChange={handleFileChange}
            className="file-input"
          />
          <button type="button" className="ghost" onClick={handleFileClick}>
            Load File
          </button>
        </div>
      </div>

      <main className="panes">
        <section className="pane">
          <div className="pane-header">
            <h2>Input</h2>
            <span className="hint">Paste UE Clipboard text here.</span>
          </div>
          <textarea
            className="editor"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Begin Object Class=/Script/NiagaraEditor.NiagaraClipboardContent..."
          />
        </section>

        <section className="pane">
          <div className="pane-header">
            <h2>Output</h2>
            <div className="tabs">
              {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={key === activeTab ? 'tab active' : 'tab'}
                  onClick={() => setActiveTab(key)}
                >
                  {TAB_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
          <pre className="output">{outputText || 'No output yet.'}</pre>
        </section>
      </main>

      {(result.errors.length > 0 || result.warnings.length > 0) && (
        <section className="diagnostics">
          {result.errors.length > 0 && (
            <div>
              <h3>Errors</h3>
              <ul>
                {result.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div>
              <h3>Warnings</h3>
              <ul>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default App
