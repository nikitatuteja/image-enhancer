import express from "express";
import rateLimit from "express-rate-limit";
import sharp from "sharp";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "15mb" }));
app.use(express.static("public"));

const {
  GEMINI_API_KEY,
  GEMINI_MODEL = "gemini-3-pro-image-preview",
  GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models",
  IMAGE_SIZE = "2K",
  RATE_LIMIT_MAX = "10",
} = process.env;

if (!GEMINI_API_KEY || GEMINI_API_KEY === "PASTE_YOUR_KEY_HERE") {
  console.error("Missing GEMINI_API_KEY. Add it to the .env file.");
  process.exit(1);
}

const COMMON =
  "Keep the exact same framing, crop, aspect ratio, pose, facial features and expression. " +
  "Do not add, remove, move or restyle any object or person. Do not fade or wash out the image; " +
  "keep strong natural contrast with deep shadows and clean highlights. Output at the highest resolution possible.";

const PROMPTS = {
  restore:
    "Restore and enhance this photograph as a professional photo restorer would. " +
    "Recover fine detail and micro-contrast, especially in the face, hair, fabric, lace and foliage. " +
    "Sharpen edges, remove blur, noise and compression artifacts, and remove dust, scratches and stains. " +
    "Preserve the original tonal style and color palette (for example sepia or black and white) and keep natural film texture; " +
    "do not over-smooth skin or give it a plastic look. " + COMMON,
  sharpen:
    "Make this photo noticeably sharper and clearer. Recover real detail, fix blur and reduce noise, " +
    "while keeping natural texture and the original colors and lighting unchanged. " + COMMON,
  color:
    "Improve the lighting, exposure, white balance, color accuracy and dynamic range of this photo " +
    "like a professional retoucher. Keep it natural and realistic, and keep all details sharp. " + COMMON,
  colorize:
    "Colorize this black and white or sepia photo with realistic, historically plausible natural colors, " +
    "including accurate skin tones. Also sharpen details and remove dust and scratches. " + COMMON,
};

const RATIOS = { "1:1": 1, "2:3": 2 / 3, "3:2": 3 / 2, "3:4": 3 / 4, "4:3": 4 / 3, "4:5": 4 / 5, "5:4": 5 / 4, "9:16": 9 / 16, "16:9": 16 / 9, "21:9": 21 / 9 };
function nearestRatio(w, h) {
  const r = w / h;
  return Object.entries(RATIOS).sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0];
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(RATE_LIMIT_MAX),
  message: { error: "Too many requests. Please try again later." },
});

async function callGemini(body) {
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

app.post("/api/enhance", limiter, async (req, res) => {
  try {
    const { image, mimeType, mode = "restore", postProcess = true } = req.body || {};
    if (!image || !/^image\/(jpeg|png|webp)$/.test(mimeType))
      return res.status(400).json({ error: "Send a JPEG, PNG or WebP image." });

    const prompt = PROMPTS[mode] || PROMPTS.restore;
    const inputBuf = Buffer.from(image, "base64");
    const meta = await sharp(inputBuf).metadata();
    const ratio = nearestRatio(meta.width, meta.height);

    const isPro = /pro|gemini-3/.test(GEMINI_MODEL);
    const makeBody = (withImageConfig) => ({
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: image } }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        temperature: 0.3,
        ...(withImageConfig && {
          imageConfig: { aspectRatio: ratio, ...(isPro && IMAGE_SIZE ? { imageSize: IMAGE_SIZE } : {}) },
        }),
      },
    });

    let result = await callGemini(makeBody(true));
    if (!result.ok && result.status === 400) result = await callGemini(makeBody(false)); // retry without imageConfig
    if (!result.ok)
      return res.status(result.status).json({ error: result.data.error?.message || "API error" });

    const parts = result.data.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img)
      return res.status(502).json({ error: "No image returned (possibly blocked by safety filters)." });

    const d = img.inlineData || img.inline_data;
    let outBuf = Buffer.from(d.data, "base64");
    let outMime = d.mimeType || d.mime_type || "image/png";

    if (postProcess) {
      try {
        let p = sharp(outBuf);
        const m = await p.metadata();
        if (m.width < meta.width) p = p.resize({ width: meta.width, kernel: "lanczos3" });
        outBuf = await p
          .normalise({ lower: 1, upper: 99 }) // restore contrast
          .sharpen({ sigma: 1.0, m1: 1, m2: 2 })
          .png()
          .toBuffer();
        outMime = "image/png";
      } catch (e) {
        console.warn("Post-processing skipped:", e.message);
      }
    }

    res.json({ image: outBuf.toString("base64"), mimeType: outMime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Running at http://localhost:${port} (model: ${GEMINI_MODEL})`));
