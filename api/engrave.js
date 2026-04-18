// /api/engrave.js — v3: AI engraving with sharp post-processing
// Deploy to: Vercel serverless function
// Requires: npm install replicate sharp
// Env vars: REPLICATE_API_TOKEN

import Replicate from "replicate";
import sharp from "sharp";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ─── Retry wrapper for Replicate rate limits ─────────────────────────
async function runWithRetry(modelId, input, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await replicate.run(modelId, { input });
    } catch (err) {
      const status = err?.response?.status || err?.status;
      const isRateLimit = status === 429 || (err.message && err.message.includes("rate"));
      const isServerError = status >= 500;

      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.log(`[engrave] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms (${status || err.message})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// ─── Extract URL from Replicate output (various formats) ────────────
function extractUrl(output, label) {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  if (output && typeof output === "object") {
    const url = output.url || output.output || output.image || output.png || output.result;
    if (typeof url === "string") return url;
  }
  throw new Error(`[${label}] Could not extract URL from output: ${JSON.stringify(output).substring(0, 200)}`);
}

// ─── Prompts ─────────────────────────────────────────────────────────
const PROMPT_BG_REMOVED = [
  "Convert this photo into a high-density monochrome laser engraving render.",
  "White on pure black background.",
  "The result should look nearly photographic but rendered entirely in fine white points.",
  "Smooth continuous tonal range from dense bright areas to sparse dark areas.",
  "No visible dot pattern, no stipple texture, no dithering artifacts.",
  "Preserve exact facial likeness, proportions, and all fine details.",
  "No stylization, no glow, no blur, no glass, no crystal object.",
  "Clean, sharp, photorealistic monochrome render.",
].join(" ");

const PROMPT_BG_KEPT = [
  "Convert this photo into a high-density monochrome laser engraving render.",
  "White on pure black background.",
  "The result should look nearly photographic but rendered entirely in fine white points.",
  "Smooth continuous tonal range from dense bright areas to sparse dark areas.",
  "Include the full scene with background and all elements.",
  "No visible dot pattern, no stipple texture, no dithering artifacts.",
  "Preserve exact likeness, proportions, composition, and all fine details.",
  "No stylization, no glow, no blur, no glass, no crystal object.",
  "Clean, sharp, photorealistic monochrome render.",
].join(" ");

// ─── Sharp post-processing: black bg → transparent (luminance as alpha) ──
async function convertBlackToTransparent(imageUrl) {
  console.log("[engrave] Fetching AI output for sharp processing...");
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch AI output: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  console.log("[engrave] Running sharp: luminance → alpha...");

  // Extract raw pixel data
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = width * height;
  const output = Buffer.alloc(pixels * 4); // RGBA

  for (let i = 0; i < pixels; i++) {
    const srcIdx = i * channels;
    const dstIdx = i * 4;

    const r = data[srcIdx];
    const g = data[srcIdx + 1];
    const b = data[srcIdx + 2];

    // Perceptual luminance
    const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

    // White pixel, luminance becomes alpha
    // This maps black (0) → fully transparent, white (255) → nearly opaque
    output[dstIdx] = 255;     // R
    output[dstIdx + 1] = 255; // G
    output[dstIdx + 2] = 255; // B
    output[dstIdx + 3] = luminance; // A = luminance
  }

  const pngBuffer = await sharp(output, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();

  console.log(`[engrave] Sharp done: ${(pngBuffer.length / 1024).toFixed(0)}KB transparent PNG`);

  // Return as base64 data URL
  return `data:image/png;base64,${pngBuffer.toString("base64")}`;
}

// ─── Main handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
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

    // Resolve image input
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

    // ── Step 1: Background removal (optional) ──
    if (removeBackground) {
      console.log("[engrave] Step 1: Removing background...");
      const bgOutput = await runWithRetry("recraft-ai/recraft-remove-background", {
        image: imageInput,
      });
      processedUrl = extractUrl(bgOutput, "remove-background");
      console.log("[engrave] Background removed:", processedUrl.substring(0, 80) + "...");
    }

    // ── Step 2: AI engraving via google/nano-banana-pro ──
    const prompt = removeBackground ? PROMPT_BG_REMOVED : PROMPT_BG_KEPT;
    console.log(`[engrave] Step 2: Running engraving model (removeBackground=${removeBackground})...`);

    const engraveOutput = await runWithRetry("google/nano-banana-pro", {
      image_input: [processedUrl],
      prompt,
    });
    const rawEngravingUrl = extractUrl(engraveOutput, "engraving");
    console.log("[engrave] AI engraving done:", rawEngravingUrl.substring(0, 80) + "...");

    // ── Step 3: Post-processing — black bg → transparent via sharp ──
    console.log("[engrave] Step 3: Converting black→transparent (sharp)...");
    const transparentEngravingUrl = await convertBlackToTransparent(rawEngravingUrl);

    console.log("[engrave] All done! Returning transparent engraving.");

    return res.status(200).json({
      engravingUrl: transparentEngravingUrl,
      sourceForEngravingUrl: processedUrl,
      rawEngravingUrl, // debug: the pre-sharp AI output
    });
  } catch (error) {
    console.error("[engrave] Error:", error);
    return res.status(500).json({
      error: "AI processing failed",
      details: String(error?.message || error),
    });
  }
}

