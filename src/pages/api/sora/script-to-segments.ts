import type { NextApiRequest, NextApiResponse } from "next";

const DEFAULT_SYSTEM_PROMPT = `You are a professional video production assistant. Your task is to break down a script into individual segment prompts for AI video generation (Sora 2).

Each segment should be a detailed visual description of a 10-15 second video scene. Focus on:
- Visual elements (what's shown on screen)
- Camera angles and movements
- Lighting and atmosphere
- Character actions and expressions
- Setting and environment details

Output ONLY the segment prompts, one per line, separated by newlines. Do not include segment numbers, labels, or any other text. Each prompt should be self-contained and descriptive enough for an AI video generator to create the scene.`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { script, systemPrompt, apiKey } = req.body;

  const openaiKey = apiKey || process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    return res.status(400).json({ error: "OpenAI API key is required" });
  }

  if (!script) {
    return res.status(400).json({ error: "Script is required" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: systemPrompt || DEFAULT_SYSTEM_PROMPT,
          },
          { role: "user", content: script },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error?.message || "OpenAI API request failed"
      );
    }

    const content = data.choices?.[0]?.message?.content || "";
    const segments = content
      .split("\n")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    return res.status(200).json({ segments });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to convert script";
    return res.status(500).json({ error: message });
  }
}
