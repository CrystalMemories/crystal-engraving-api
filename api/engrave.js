// /api/engrave.js
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

/**
 * Run a Replicate model with automatic retry on 429 rate limits.
 */
async function runWithRetry(model, input, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await replicate.run(model, { input });
    } catch (err) {
      const errStr = String(err);
      const is429 = err?.status === 429 || errStr.includes("429") || errStr.includes("throttled");
      if (!is429 || attempt === maxRetries) throw err;

      const waitMs = (attempt + 1) * 10000;
      console.log(`[engrave] Rate limited on ${model}, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
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

    // --- Step 1: Background removal (optional) ---
    if (removeBackground) {
      const output = await runWithRetry("recraft-ai/recraft-remove-background", { image: imageInput });
      console.log("MODEL OUTPUT (remove-background):", output);

      processedUrl = extractUrl(output);
      if (!processedUrl || typeof processedUrl !== "string" || !processedUrl.startsWith("http")) {
        throw new Error("Could not extract output URL. Got: " + JSON.stringify(output));
      }
    }

    // --- Step 2: AI engraving via google/nano-banana ---
    console.log("[engrave] Running engraving model (google/nano-banana)...");
    const engraveOutput = await runWithRetry("google/nano-banana", {
      image: processedUrl,
      prompt:
        "Convert this photo into a 3D crystal laser engraving. Monochrome white and light gray tones only, no color. Clean subsurface-etched look with fine detail, as if laser-engraved inside a glass crystal block. Transparent background.",
    });

    console.log("MODEL OUTPUT (engraving):", engraveOutput);

    const engravingUrl = extractUrl(engraveOutput);
    if (!engravingUrl || typeof engravingUrl !== "string") {
      throw new Error("Could not extract engraving URL. Got: " + JSON.stringify(engraveOutput));
    }

    console.log("[engrave] Done!", engravingUrl.substring(0, 80) + "...");

    return res.status(200).json({
      sourceForEngravingUrl: processedUrl,
      engravingUrl: engravingUrl,
    });
  } catch (error) {
    console.error("Engrave error:", error);
    return res
      .status(500)
      .json({ error: "AI processing failed", details: String(error) });
  }
}
