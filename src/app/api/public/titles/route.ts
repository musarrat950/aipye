import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 10; // seconds

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

type UnknownRecord = Record<string, unknown>;

function normalizeTitlesFromJson(json: unknown): string[] {
  const obj = (json && typeof json === "object" ? (json as UnknownRecord) : {}) as UnknownRecord;
  const src = (obj["titles"] ?? obj["suggestions"]) as unknown;
  let titles: string[] = [];
  if (typeof src === "string") {
    titles = src.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(src)) {
    titles = src
      .map((s): string => {
        if (typeof s === "string") return s.trim();
        if (s && typeof s === "object") {
          const r = s as UnknownRecord;
          const val = r["title"] ?? r["text"] ?? r["suggestion"];
          if (typeof val === "string") return val.trim();
          const anyString = Object.values(r).find((v) => typeof v === "string");
          if (typeof anyString === "string") return anyString.trim();
          return String(s).trim();
        }
        return String(s).trim();
      })
      .filter(Boolean);
  } else if (src && typeof src === "object") {
    const r = src as UnknownRecord;
    const maybe = (r["title"] ?? r["text"] ?? r["suggestion"]) as unknown;
    if (typeof maybe === "string") titles = [maybe.trim()];
  }
  titles = titles
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.length > 45 ? t.slice(0, 45).trim() : t));
  return Array.from(new Set(titles));
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body && typeof body === "object" ? (body as UnknownRecord) : {}) as UnknownRecord;
    const description = typeof raw["description"] === "string" ? (raw["description"] as string) : undefined;
    const keywords = Array.isArray(raw["keywords"]) ? (raw["keywords"] as unknown[]).filter((k): k is string => typeof k === "string") : undefined;
    const niche = typeof raw["niche"] === "string" ? (raw["niche"] as string) : undefined;
    const language = typeof raw["language"] === "string" ? (raw["language"] as string) : undefined;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable" },
        { status: 500, headers: corsHeaders() },
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await (ai as unknown as { models: { generateContent: (args: unknown) => Promise<unknown> } }).models.generateContent({
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
    } as unknown);

    // Extract text
    async function extractText(resp: unknown): Promise<string> {
      try {
        const r = resp as UnknownRecord;
        const hasTextFn = r && typeof r === "object" && typeof (r as UnknownRecord)["text"] === "function";
        if (hasTextFn) return await (r as { text: () => Promise<string> }).text();
        const responseObj = (r && typeof r === "object" ? (r["response"] as UnknownRecord | undefined) : undefined);
        if (responseObj && typeof responseObj["text"] === "function") {
          return await (responseObj as { text: () => Promise<string> }).text();
        }
        if (typeof (r as UnknownRecord)["outputText"] === "string") return String((r as UnknownRecord)["outputText"]);
        const rr = r as { response?: { candidates?: unknown[] }; candidates?: unknown[] };
        const candidates = rr?.response?.candidates || rr?.candidates;
        if (Array.isArray(candidates) && candidates.length) {
          const first = candidates[0] as UnknownRecord;
          const content = first?.["content"] as UnknownRecord | undefined;
          const parts = (content?.["parts"] as unknown) as unknown[] | undefined;
          if (Array.isArray(parts)) {
            const joined = parts
              .map((p) => (p && typeof p === "object" && typeof (p as UnknownRecord)["text"] === "string" ? String((p as UnknownRecord)["text"]) : ""))
              .filter(Boolean)
              .join("\n");
            if (joined) return joined;
          }
          const textField = (content && typeof (content as UnknownRecord)["text"] === "string" ? String((content as UnknownRecord)["text"]) : (typeof first["text"] === "string" ? String(first["text"]) : ""));
          if (textField.trim()) return textField;
        }
        const contentObj = (r && typeof r === "object" ? (r["content"] as UnknownRecord | undefined) : undefined);
        const parts2 = (contentObj?.["parts"] as unknown) as unknown[] | undefined;
        if (Array.isArray(parts2)) {
          const joined = parts2
            .map((p) => (p && typeof p === "object" && typeof (p as UnknownRecord)["text"] === "string" ? String((p as UnknownRecord)["text"]) : ""))
            .filter(Boolean)
            .join("\n");
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

    function tryParseJson(s: string): unknown | null {
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
  } catch (err: unknown) {
    const message = (err && typeof err === "object" && "message" in err) ? String((err as { message?: string }).message) : "Unexpected error";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders() },
    );
  }
}
