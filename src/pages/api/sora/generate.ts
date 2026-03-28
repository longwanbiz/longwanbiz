import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { apiKey, prompt, aspectRatio, nFrames, quality, removeWatermark, imageUrls } =
    req.body;

  if (!apiKey) {
    return res.status(400).json({ error: "Kie AI API key is required" });
  }

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  const model =
    imageUrls && imageUrls.length > 0
      ? "sora-2-pro-image-to-video"
      : "sora-2-pro-text-to-video";

  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspectRatio || "landscape",
    n_frames: String(nFrames || "10"),
    size: quality || "standard",
    remove_watermark: removeWatermark ?? true,
  };

  if (imageUrls && imageUrls.length > 0) {
    input.image_urls = imageUrls;
  }

  try {
    const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input }),
    });

    const data = await response.json();

    if (data.code !== 200) {
      return res
        .status(400)
        .json({ error: data.msg || "Failed to create task" });
    }

    return res.status(200).json({ taskId: data.data.taskId });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
