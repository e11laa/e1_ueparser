# UE Clipboard Parser

Browser-only parser for Unreal Engine 5 Niagara/Blueprint clipboard text. Paste UE clipboard text and convert it into structured JSON, including decoded `ExportedNodes`.

## Features
- Parse UE clipboard text into structured JSON
- Decode `ExportedNodes` (Base64) and parse nested objects
- Tabbed output: AI JSON, Raw JSON, Decoded ExportedNodes, Markdown Summary
- Copy / Download JSON, load sample text, load from file
- Error and warning diagnostics

## Development

Do not open `index.html` directly from the filesystem. This project uses Vite, so the
source HTML must be served by the dev server.

```bash
npm install
npm run dev
```

## Vercel Deployment

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Root Directory: `./`

This app is browser-only. It does not require server APIs or environment variables.

## Tests

```bash
npm run test
```
