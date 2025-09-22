import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

// CORS helpers
const ALLOWED_ORIGIN = "*"; // Adjust if you want to restrict
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  } as Record<string, string>;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function buildSystemInstruction() {
  return [
    {
      role: "system" as const,
      parts: [
        {
          text: [
            "You are an assistant that suggests YouTube video titles.",
            "Constraints:",
            "- Output MUST be a single JSON object.",
            "- Keep sentences short and formal with a casual feel (concise, catchy).",
            "- Focus on SEO-friendly titles, avoid clickbait hype.",
            "- Return only valid JSON. Do not include markdown code fences.",
            "- Use the schema strictly.",
            "JSON schema:",
            '{',
            '  "summary": {',
            '    "topic": string,',
            '    "angle": string,',
            '    "audience": string,',
            '    "notes": string',
            '  },',
            '  "titles": string // a comma-separated list of video titles',
            '}',
            "Rules:",
            "- titles must be a single string, with titles separated by commas.",
            "- Provide 8-12 options where possible.",
            "- Each title MUST be very short: strictly <= 45 characters.",
            "- Prefer crisp wording, drop filler words, avoid emojis and excessive punctuation.",
            "- Respond with JSON only. No preface, no prose.",
            "- Each title should directly answer the provided video description.",
            "- Each title must be a plain string, not an object.",
            "- Do not return titles as an array or object - only as a comma-separated string.",
            'Example: "titles": "Title 1, Title 2, Title 3, Title 4"'
          ].join("\n"),
        },
      ],
    },
  ];
}

function buildUserPrompt(input: {
  description?: string;
  keywords?: string[];
  niche?: string;
  language?: string;
}) {
  const lines: string[] = [];
  if (input.description) lines.push(`Description: ${input.description}`);
  if (input.keywords?.length) lines.push(`Keywords: ${input.keywords.join(", ")}`);
  if (input.niche) lines.push(`Niche: ${input.niche}`);
  if (input.language) lines.push(`Language: ${input.language}`);
  lines.push("Respond in JSON only, no extra text.");
  lines.push("All titles must be <= 45 characters each.");
  return lines.join("\n");
}

function normalizeTitlesFromJson(json: any): string[] {
  let titles: string[] = [];
  const src = json?.titles ?? json?.suggestions;
  if (typeof src === "string") {
    titles = src
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(src)) {
    titles = src.map((s) => (typeof s === "string" ? s.trim() : (s?.title || s?.text || s?.suggestion || String(s)).trim()));
  } else if (src && typeof src === "object") {
    const maybe = src.title || src.text || src.suggestion;
    if (typeof maybe === "string") titles = [maybe.trim()];
  }
  // Ensure max length and non-empty
  titles = titles
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.length > 45 ? t.slice(0, 45).trim() : t));
  return Array.from(new Set(titles));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const { description, keywords, niche, language } = body || {};

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable" },
        { status: 500, headers: corsHeaders() },
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      systemInstruction: buildSystemInstruction(),
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt({ description, keywords, niche, language }) }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            summary: {
              type: "object",
              properties: {
                topic: { type: "string" },
                angle: { type: "string" },
                audience: { type: "string" },
                notes: { type: "string" },
              },
              required: ["topic", "angle", "audience", "notes"],
            },
            titles: { type: "string" },
          },
          required: ["titles"],
        },
        temperature: 0.7,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 2048,
      },
    });

    // Extract text
    async function extractText(resp: any): Promise<string> {
      try {
        if (resp && typeof resp.text === "function") return await resp.text();
        if (resp?.response && typeof resp.response.text === "function") return await resp.response.text();
        if (typeof resp?.outputText === "string") return resp.outputText;
        const candidates = resp?.response?.candidates || resp?.candidates;
        if (Array.isArray(candidates) && candidates.length) {
          const parts = candidates[0]?.content?.parts;
          if (Array.isArray(parts)) {
            const joined = parts.map((p: any) => p?.text || "").filter(Boolean).join("\n");
            if (joined) return joined;
          }
          const textField = candidates[0]?.content?.text || candidates[0]?.text;
          if (typeof textField === "string" && textField.trim()) return textField;
        }
        const parts = resp?.content?.parts;
        if (Array.isArray(parts)) {
          const joined = parts.map((p: any) => p?.text || "").filter(Boolean).join("\n");
          if (joined) return joined;
        }
        if (typeof resp === "string") return resp;
        return JSON.stringify(resp);
      } catch {
        return String(resp);
      }
    }

    function stripCodeFences(s: string) {
      return s
        .replace(/^```json\n?/i, "")
        .replace(/^```\n?/i, "")
        .replace(/\n?```\s*$/i, "");
    }

    function tryParseJson(s: string): any | null {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }

    const rawText = await extractText(response);
    const stripped = stripCodeFences(rawText);
    const parsed = tryParseJson(stripped) ?? tryParseJson(rawText);

    if (!parsed) {
      return NextResponse.json(
        { error: "Model returned non-JSON output", raw: rawText },
        { status: 502, headers: corsHeaders() },
      );
    }

    const titles = normalizeTitlesFromJson(parsed);
    if (!titles.length) {
      return NextResponse.json(
        { error: "No titles produced", raw: parsed },
        { status: 502, headers: corsHeaders() },
      );
    }

    return NextResponse.json(
      {
        titles,
        meta: {
          count: titles.length,
          maxLength: 45,
          model: "gemini-2.5-flash",
        },
      },
      { headers: corsHeaders() },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected error" },
      { status: 500, headers: corsHeaders() },
    );
  }
}
