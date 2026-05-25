# UE Clipboard Parser

Browser-only parser for Unreal Engine 5 Niagara/Blueprint clipboard text. Paste UE clipboard text and convert it into structured JSON, including decoded `ExportedNodes`.

## Features
- Parse UE clipboard text into structured JSON
- Decode `ExportedNodes` (Base64) and parse nested objects
- Tabbed output: AI JSON, Raw JSON, Decoded ExportedNodes, Markdown Summary
- Copy / Download JSON, load sample text, load from file
- Error and warning diagnostics

## Development

```bash
npm install
npm run dev
```

## Tests

```bash
npm run test
```
