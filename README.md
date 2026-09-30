# AI Image Enhancer (Gemini) v2

## Setup
1. Install Node.js 20 or newer.
2. Open `.env`, replace `PASTE_YOUR_KEY_HERE` with your key, and confirm the model name.
3. Run:
   ```
   npm install
   npm start
   ```
   (Restart the server after any change to `.env` or `server.js`.)
4. Open http://localhost:3000

## Tips for best results
- Use the Pro image model (`GEMINI_MODEL` in `.env`); the flash model gives softer results.
- Pick the mode that matches your photo. "Old photo restore" keeps sepia/B&W tone.
- If the result looks over-processed, untick the post-process box.
- 403 / PERMISSION_DENIED: switch `GEMINI_BASE_URL` to the Vertex endpoint.
- 429 / quota: make sure billing is enabled for the key's project.
- Model not found (404): check the current model name in Google's image generation docs.
