export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const { imageBase64, removeBackground, hasLightbase } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "Missing imageBase64" });

    const basePrompt = `
Create a realistic 3D laser crystal engraving render of the provided photo.

OUTPUT REQUIREMENTS:
- Transparent PNG background
- Subject centered
- No crystal, no product mockup, no frame
- Only the engraved subject itself
- High contrast grayscale
- Clean edges, professional laser engraving style
- Subject must fit fully within frame, no cropping
- Keep original proportions
- Minimum height 2000px
`;

    const bgPrompt = removeBackground
      ? `Remove the background completely. Keep only the main subjects. Smooth clean cutout edges.`
      : `Keep the original background but convert everything into subtle engraving style. Ensure the background is faint and does not overpower the subjects.`;

    const lightPrompt = hasLightbase
      ? `Slightly brighter engraving to simulate illuminated crystal.`
      : `Slightly softer engraving to simulate non-illuminated crystal.`;

    const prompt = `${basePrompt}\n${bgPrompt}\n${lightPrompt}`.trim();

    const resp = await fetch("https://api.nanobananopro.com/process", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NANO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: imageBase64,
        prompt
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: "NanoBanano error", details: text });
    }

    const data = await resp.json();
    const engravingUrl = data.resultUrl || data.output_url || data.url;

    if (!engravingUrl) return res.status(500).json({ error: "Missing engraving URL in provider response" });

    return res.status(200).json({ engravingUrl });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
