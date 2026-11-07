import path from "node:path"
import { readFileSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

// Keep OCR workers, WASM cores and language data on the app's own origin.
function ocrAssets(): Plugin {
  const files: Record<string, string> = {
    "ocr/worker.min.js": "tesseract.js/dist/worker.min.js",
    "ocr/lang/eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "ocr/lang/fra.traineddata.gz": "@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz",
  }
  for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"])
    files[`ocr/core/tesseract-core-${variant}.wasm.js`] = `tesseract.js-core/tesseract-core-${variant}.wasm.js`
  const read = (relative: string) => readFileSync(path.resolve(__dirname, "node_modules", relative))
  return {
    name: "local-ocr-assets",
    generateBundle() {
      for (const [fileName, relative] of Object.entries(files))
        this.emitFile({ type: "asset", fileName, source: read(relative) })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url || "").split("?")[0].replace(/^\//, "")
        if (!files[key]) return next()
        res.setHeader("Content-Type", key.endsWith(".js") ? "text/javascript" : "application/octet-stream")
        res.end(read(files[key]))
      })
    },
  }
}
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss(), ocrAssets()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
})
