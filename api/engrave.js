// /api/engrave.js
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

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
      const output = await replicate.run("recraft-ai/recraft-remove-background", {
        input: { image: imageInput },
      });

      console.log("MODEL OUTPUT (remove-background):", output);

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

      if (typeof processedUrl !== "string" || !processedUrl.startsWith("http")) {
        throw new Error(
          "Could not extract output URL. Got: " + JSON.stringify(processedUrl)
        );
      }
    }

    // --- Step 2: AI engraving via google/nano-banana ---
    console.log("[engrave] Running engraving model (google/nano-banana)...");
    const engraveOutput = await replicate.run("google/nano-banana", {
      input: {
        image: processedUrl,
        prompt:
          "Convert this photo into a 3D crystal laser engraving. Monochrome white and light gray tones only, no color. Clean subsurface-etched look with fine detail, as if laser-engraved inside a glass crystal block. Transparent background.",
      },
    });

    console.log("MODEL OUTPUT (engraving):", engraveOutput);

    let engravingUrl;
    if (typeof engraveOutput === "string") {
      engravingUrl = engraveOutput;
    } else if (Array.isArray(engraveOutput) && typeof engraveOutput[0] === "string") {
      engravingUrl = engraveOutput[0];
    } else if (engraveOutput && typeof engraveOutput === "object") {
      engravingUrl =
        engraveOutput.url ||
        engraveOutput.output ||
        engraveOutput.image ||
        engraveOutput.png ||
        engraveOutput.result;
    }

    if (!engravingUrl || typeof engravingUrl !== "string") {
      throw new Error(
        "Could not extract engraving URL. Got: " + JSON.stringify(engraveOutput)
      );
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
