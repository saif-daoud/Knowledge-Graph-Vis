# Knowledge Graph Vis

Interactive schema editor for the M3 clinical and Islamic-cultural knowledge graph drafts.

The app is a static React/Cytoscape site. It loads generated schema JSON files, lets an expert edit node types, relation types, descriptions, support metadata, and properties, and keeps a detailed local review trail with before/after values.

## Expert Access

The first page is an access-code gate. After a valid code, the app moves to `#/review`. If someone opens `#/review` without an active browser session, the app immediately redirects back to `#/access`.

This is client-side gating for a static site. For stronger access control, add a Cloudflare Worker or Pages Function later.

The production build reads an optional `VITE_ACCESS_CODE_HASH` secret. If it is not set, the app uses the current review code hash already configured in source.

## Run Locally

```cmd
npm.cmd install
npm.cmd run dev
```

The data preparation step reads:

- `M3/outputs/two_kg_schema/clinical_kg_schema.json`
- `M3/outputs/two_kg_schema/islamic_cultural_kg_schema.json`
- `M3/outputs/two_kg_schema/book_schema_candidates/*.json`

## Build

```cmd
npm.cmd run build
```

## Deploy

The included GitHub Actions workflow deploys `dist/` to Cloudflare Pages project `knowledge-graph-vis`.

Required GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Optional secret:

- `VITE_ACCESS_CODE_HASH`

## Review Features

- Add/delete node types and relation types directly from the graph workspace.
- Edit names, descriptions, support sources, and node/relation property metadata from the right inspector.
- Click a change-log entry to highlight the affected graph entity.
- Deleted nodes/relations reappear as red dashed ghost elements when their log entry is focused.
- Edited fields show hoverable before/after evidence in the inspector.
- Export a review package containing the final schema and local change trail.
