"use client";

import Image from "next/image";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export default function Home() {
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [niche, setNiche] = useState("");
  const [language, setLanguage] = useState("English");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<any | string | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function copyTitleToClipboard(title: string, index: number) {
    try {
      await navigator.clipboard.writeText(title);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch (e) {
      console.error("Copy failed", e);
    }
  }

  const disabled = useMemo(() => !description.trim() || loading, [description, loading]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setRawResponse(null);
    setTitles([]);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          keywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          niche: niche || undefined,
          language: language || undefined,
        }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Request failed");
        // Prefer rendering only the titles if present
        const titlesField = (data && (data.titles ?? data.suggestions)) as unknown;
        if (typeof titlesField === "string") {
          const arr = titlesField
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          setTitles(arr);
        } else if (Array.isArray(titlesField)) {
          const arr = (titlesField as any[])
            .map((s) => (typeof s === "string" ? s.trim() : (s?.title || s?.text || s?.suggestion || String(s)).trim()))
            .filter(Boolean);
          setTitles(arr);
        } else {
          setRawResponse(data);
        }
      } else {
        const text = await res.text();
        if (!res.ok) throw new Error(text || "Request failed");
        setRawResponse(text);
      }
    } catch (err: any) {
      setError(err?.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl p-6 sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/next.svg" alt="Logo" width={120} height={24} className="dark:invert" />
          <span className="text-sm text-muted-foreground">YouTube Title Suggester (Gemini 2.5 Flash)</span>
        </div>

        <Card className="border-neutral-200 dark:border-neutral-800">
          <CardHeader>
            <CardTitle className="text-lg">Describe your video</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="What is the video about? Main points, value, or outcome..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-28"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                  <Input
                    id="keywords"
                    placeholder="e.g. react, hooks, performance"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="niche">Niche</Label>
                  <Input
                    id="niche"
                    placeholder="e.g. programming, fitness, travel"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    placeholder="e.g. English, Hindi, Spanish"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={disabled} className="w-full">
                    {loading ? "Generating..." : "Generate titles"}
                  </Button>
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </form>
          </CardContent>
        </Card>

        {titles.length > 0 && (
          <Card className="mt-8 border-neutral-200 dark:border-neutral-800">
            <CardHeader>
              <CardTitle className="text-lg">Titles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {titles.map((t, i) => (
                  <Card key={`${i}-${t}`} className="border-neutral-200 dark:border-neutral-800">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-sm sm:text-base leading-relaxed cursor-help">
                              {t}
                              {i < titles.length - 1 ? "," : ""}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={6}>{t.length} chars</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              aria-label="Copy title"
                              onClick={() => copyTitleToClipboard(t, i)}
                              className="shrink-0"
                            >
                              {copiedIndex === i ? "Copied" : "Copy"}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={6}>
                            {copiedIndex === i ? "Copied!" : "Copy title"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {titles.length === 0 && rawResponse !== null && (
          <Card className="mt-8 border-neutral-200 dark:border-neutral-800">
            <CardHeader>
              <CardTitle className="text-lg">AI Response</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap break-words text-sm sm:text-base">
                {typeof rawResponse === "string"
                  ? rawResponse
                  : JSON.stringify(rawResponse, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
