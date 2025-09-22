/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const { description, keywords, niche, language } = body || {};

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable" },
        { status: 500 },
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
        // Encourage strict JSON output
        responseMimeType: "application/json",
        // Provide a response schema to strongly bias JSON structure
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

    // Extract text from response (handle multiple SDK shapes)
    async function extractText(resp: any): Promise<string> {
      try {
        if (resp && typeof resp.text === "function") {
          return await resp.text();
        }
        if (resp?.response && typeof resp.response.text === "function") {
          return await resp.response.text();
        }
        if (typeof resp?.outputText === "string") {
          return resp.outputText;
        }
        // Google GenAI common shapes
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
        // Last resort: JSON stringify to avoid [object Object]
        return JSON.stringify(resp);
      } catch {
        return String(resp);
      }
    }

    const text = await extractText(response);

    // Debug: log raw response
    console.log("Raw model response:", text);

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

    const stripped = stripCodeFences(text);
    const parsed = tryParseJson(stripped) ?? tryParseJson(text);
    if (parsed !== null) {
      return NextResponse.json(parsed);
    }

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
