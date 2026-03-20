import { type NextApiRequest, type NextApiResponse } from "next";

// In-memory store for uploaded document content per user
const documentStore: { [userId: string]: string[] } = {};

export const getDocuments = (userId: string): string[] => {
  return documentStore[userId] || [];
};

export const clearDocuments = (userId: string): void => {
  delete documentStore[userId];
};

// Disable default body parser so we can handle text content
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

const upload = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = JSON.parse(req.body);
    const { userId, fileName, fileContent } = body;

    if (!userId || !fileName || !fileContent) {
      res.status(400).json({ error: "Missing userId, fileName, or fileContent" });
      return;
    }

    if (!documentStore[userId]) {
      documentStore[userId] = [];
    }

    const docEntry = `--- Document: ${fileName} ---\n${fileContent}\n--- End of ${fileName} ---`;
    documentStore[userId].push(docEntry);

    res.status(200).json({
      success: true,
      message: `Document "${fileName}" uploaded successfully`,
      documentCount: documentStore[userId].length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to process upload" });
  }
};

export default upload;
