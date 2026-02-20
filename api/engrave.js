import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

export default async function handler(req, res) {
  // CORS (we’ll tighten to your Shopify domain later)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { imageBase64, imageUrl, removeBackground } = req.body || {};

    // Replicate can accept a data URL, so we build one from base64
    const imageInput =
      imageUrl ||
      (imageBase64
        ? (imageBase64.startsWith("data:")
            ? imageBase64
            : `data:image/png;base64,${imageBase64}`)
        : null);

    if (!imageInput) {
      return res.status(400).json({ error: "Missing imageBase64 or imageUrl" });
    }

    let processedUrl = imageInput;

    if (removeBackground) {
      const output = await replicate.run("recraft-ai/recraft-remove-background", {
        input: { image: imageInput }
      });
      processedUrl = output.url(); // transparent PNG
    }

    // For now, we return the processed layer (bg removed if requested).
    // Next step: add engraving-style transformation.
    return res.status(200).json({ engravingUrl: processedUrl });
  } catch (error) {
    console.error("Engrave error:", error);
    return res.status(500).json({ error: "AI processing failed", details: String(error) });
  }
}
