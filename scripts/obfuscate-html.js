// scripts/obfuscate-html.js
const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const BIN_DIR = path.resolve("./bin");

function obfuscateHtmlScripts(dir) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      obfuscateHtmlScripts(fullPath); // recursivo
    } else if (file.endsWith(".html")) {
      console.log("🔒 Ofuscando scripts en:", fullPath);
      let html = fs.readFileSync(fullPath, "utf8");

      // Regex para capturar <script>...</script> sin src externo
      html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, jsCode) => {
        if (!jsCode.trim()) return match; // no tocar scripts vacíos o externos

        const obfuscated = JavaScriptObfuscator.obfuscate(jsCode, {
          compact: true,
          controlFlowFlattening: true,
          stringArray: true,
          rotateStringArray: true,
          stringArrayEncoding: ["rc4"]
        });

        // Remover saltos de línea y meter todo inline
        const finalJs = obfuscated.getObfuscatedCode().replace(/[\r\n]+/g, "");

        return `<script>${finalJs}</script>`;
      });

      fs.writeFileSync(fullPath, html, "utf8");
    }
  });
}

if (fs.existsSync(BIN_DIR)) {
  obfuscateHtmlScripts(BIN_DIR);
  console.log("✅ Scripts en HTML ofuscados en /bin");
} else {
  console.log("⚠️ No existe /bin, salteando...");
}
