# AI Titles API and App Documentation

This document provides an in-depth overview of the app architecture and a public API that developers can use to generate concise YouTube video titles programmatically.

- App path: `aipye/`
- Public API route: `src/app/api/public/titles/route.ts`
- Model: Google Gemini "gemini-2.5-flash"
- Response contract: JSON with `titles: string[]`

---

## Overview

- **Purpose**: Generate multiple short, SEO-friendly YouTube titles from a description and optional context.
- **Model constraints**:
  - Titles are required to be very short (<= 45 characters).
  - Titles are intended to directly answer the provided description.
  - Output is normalized as an array of strings on the public API.

The internal app page `src/app/page.tsx` calls `/api/suggest` for the full model response and renders titles. The public developer API standardizes outputs for external consumption, returning a stable schema.

---

## Public API

- **Endpoint**: `/api/public/titles`
- **Method**: `POST`
- **CORS**: Enabled for all origins (`Access-Control-Allow-Origin: *`).
- **Auth**: None (public). No API key required for clients consuming this endpoint.

### Request Body

```json
{
  "description": "string (required)",
  "keywords": ["string", "string"],
  "niche": "string",
  "language": "string"
}
```

- **description**: Required. A few sentences describing the video content and value.
- **keywords**: Optional. A list of comma-separated keywords.
- **niche**: Optional. Topic niche, like "programming" or "fitness".
- **language**: Optional. Language for the titles, e.g., "English".

### Successful Response (200)

```json
{
  "titles": [
    "Short Title 1",
    "Short Title 2",
    "Short Title 3"
  ],
  "meta": {
    "count": 3,
    "maxLength": 45,
    "model": "gemini-2.5-flash"
  }
}
```

- `titles` is always a string array.
- Each title is normalized and trimmed to a maximum of 45 characters.
- `meta` includes convenience info.

### Error Responses

- 400/422: (not currently used) invalid payload. You can extend the API to validate input strictly.
- 500: Generic or unexpected errors.
- 502: Model returned non-JSON output or no usable titles.

Examples:
```json
{
  "error": "Missing GEMINI_API_KEY environment variable"
}
```
```json
{
  "error": "No titles produced",
  "raw": { "titles": "..." }
}
```

---

## Usage Examples

### curl

```bash
curl -X POST "http://localhost:3000/api/public/titles" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "How to learn TypeScript fast",
    "keywords": ["typescript", "beginner", "tips"],
    "niche": "programming",
    "language": "English"
  }'
```

### JavaScript (fetch)

```js
async function getTitles() {
  const res = await fetch("/api/public/titles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "How to learn TypeScript fast",
      keywords: ["typescript", "beginner", "tips"],
      niche: "programming",
      language: "English",
    }),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data = await res.json();
  return data.titles; // string[]
}
```

### Node (Axios)

```js
import axios from "axios";

async function getTitles() {
  const { data } = await axios.post(
    "http://localhost:3000/api/public/titles",
    {
      description: "How to learn TypeScript fast",
      keywords: ["typescript", "beginner", "tips"],
      niche: "programming",
      language: "English",
    },
    { headers: { "Content-Type": "application/json" } }
  );
  return data.titles; // string[]
}
```

### Python (requests)

```python
import requests

def get_titles():
    url = "http://localhost:3000/api/public/titles"
    payload = {
        "description": "How to learn TypeScript fast",
        "keywords": ["typescript", "beginner", "tips"],
        "niche": "programming",
        "language": "English",
    }
    resp = requests.post(url, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["titles"]  # list[str]
```

---

## Implementation Details

### Public API route
- File: `src/app/api/public/titles/route.ts`
- Responsibilities:
  - Accepts `POST` JSON payload.
  - Calls Google GenAI with a strict response schema and system instructions for `titles`.
  - Parses the model output and normalizes to `string[]`.
  - Trims titles to <= 45 characters and removes duplicates.
  - Sets CORS headers for public consumption.

### System Instruction
- The system prompt asks the model for an object with a `titles` field as a single comma-separated string.
- The API extracts and normalizes this to an array.
- Rules emphasize short, crisp titles that directly answer the description and avoid clickbait.

### Environment Variables
- `GEMINI_API_KEY` — required.

Set this in your shell or env file before running the dev server:

```bash
export GEMINI_API_KEY="your_api_key_here"
```

### Running Locally

```bash
# from the repository root
pnpm install # or npm install / yarn install
pnpm dev     # or npm run dev / yarn dev
```

Then call the public API at:
```
http://localhost:3000/api/public/titles
```

---

## Integration Guidance

- **Debounce requests** on input changes to avoid spamming the API.
- **Cache** results for identical prompts to reduce calls and latency.
- **Rate limiting**: Consider adding rate limiting (e.g., per-IP) before exposing publicly.
- **Retries**: Implement idempotent retries for transient network errors.
- **Validation**: Validate payload size (e.g., max description length) as desired.

Note: This public endpoint intentionally has no authorization and does not require a client API key. You may deploy it behind your own gateway if you need auth in your environment, but this repository's route is open by default.

---

## Changelog

- Added public endpoint `POST /api/public/titles` returning `{"titles": string[], "meta": {...}}`.
- Enforced concise titles (<= 45 chars) and CORS support.
- This document created to assist developers with integration.
