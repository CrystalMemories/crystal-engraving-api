// /api/engrave.js
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

async function runWithRetry(model, input, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await replicate.run(model, { input });
    } catch (err) {
      const errStr = String(err);
      const is429 = err?.status === 429 || errStr.includes("429") || errStr.includes("throttled");
      if (!is429 || attempt === maxRetries) throw err;

      const waitMs = (attempt + 1) * 3000; // 3s, 6s, 9s
      console.log(`[engrave] Rate limited, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

function extractUrl(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  if (output && typeof output === "object") {
    return output.url || output.output || output.image || output.png || output.result;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN env var" });
  }

  try {
    const { imageBase64, imageUrl, removeBackground } = req.body || {};

    const imageInput =
      imageUrl ||
      (imageBase64
        ? imageBase64.startsWith("data:")
          ? imageBase64
          : `data:image/png;base64,${imageBase64}`
        : null);

    if (!imageInput) {
      return res.status(400).json({ error: "Missing imageBase64 or imageUrl" });
    }

    let processedUrl = imageInput;

    // --- Background removal only (engraving effect is done client-side) ---
    if (removeBackground) {
      console.log("[engrave] Running background removal...");
      const output = await runWithRetry("recraft-ai/recraft-remove-background", { image: imageInput });
      console.log("MODEL OUTPUT (remove-background):", output);

      processedUrl = extractUrl(output);
      if (!processedUrl || typeof processedUrl !== "string" || !processedUrl.startsWith("http")) {
        throw new Error("Could not extract output URL. Got: " + JSON.stringify(output));
      }
      console.log("[engrave] Background removed:", processedUrl.substring(0, 80) + "...");
    }

    // Return the bg-removed (or original) image URL.
    // The engraving visual effect is applied CLIENT-SIDE for speed & consistency.
    return res.status(200).json({
      engravingUrl: processedUrl,
    });
  } catch (error) {
    console.error("Engrave error:", error);
    return res
      .status(500)
      .json({ error: "AI processing failed", details: String(error) });
  }
}
