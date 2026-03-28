import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const form = formidable({
    uploadDir,
    maxFileSize: 20 * 1024 * 1024, // 20MB
    filter: ({ mimetype }) => {
      return !!mimetype && mimetype.startsWith("image/");
    },
    filename: (_name, ext) => {
      return `${crypto.randomUUID()}${ext}`;
    },
  });

  try {
    const [, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    const filename = path.basename(file.filepath);
    const url = `/uploads/${filename}`;

    return res.status(200).json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return res.status(500).json({ error: message });
  }
}
