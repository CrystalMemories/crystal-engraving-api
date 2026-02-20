// /api/engrave.js
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export default async function handler(req, res) {
  // --- CORS (lock this down to your Shopify domain later) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") return res.status(204).end();

  // Basic validation
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN env var" });
  }

  try {
    const { imageBase64, imageUrl, removeBackground } = req.body || {};

    // Replicate can accept a normal URL OR a data URL.
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
      const output = await replicate.run("recraft-ai/recraft-remove-background", {
        input: { image: imageInput },
      });

      // Helpful for debugging in Vercel logs
      console.log("MODEL OUTPUT (remove-background):", output);

      // Robustly extract a usable URL from many possible output shapes
      if (typeof output === "string") {
        processedUrl = output;
      } else if (Array.isArray(output) && typeof output[0] === "string") {
        processedUrl = output[0];
      } else if (output && typeof output === "object") {
        processedUrl =
          output.url ||
          output.output ||
          output.image ||
          output.png ||
          output.result ||
          processedUrl;
      } else {
        throw new Error("Unexpected model output format: " + JSON.stringify(output));
      }

      // Final sanity check
      if (typeof processedUrl !== "string" || !processedUrl.startsWith("http")) {
        throw new Error(
          "Could not extract output URL. Got: " + JSON.stringify(processedUrl)
        );
      }
    }

    // NOTE:
    // For now, engravingUrl == processedUrl (bg-removed layer if requested).
    // Next step: add an engraving-style transformation model AFTER this.

    return res.status(200).json({ engravingUrl: processedUrl });
  } catch (error) {
    console.error("Engrave error:", error);
    return res
      .status(500)
      .json({ error: "AI processing failed", details: String(error) });
  }
}
