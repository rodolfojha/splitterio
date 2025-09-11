// scripts/obfuscate.js
const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const BIN_DIR = path.resolve("./bin");

function obfuscateFiles(dir) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      obfuscateFiles(fullPath); // recursivo
    } else if (file.endsWith(".js")) {
      console.log("🔒 Ofuscando:", fullPath);
      const code = fs.readFileSync(fullPath, "utf8");
      const obfuscated = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        stringArray: true,
        rotateStringArray: true,
      });
      fs.writeFileSync(fullPath, obfuscated.getObfuscatedCode(), "utf8");
    }
  });
}

if (fs.existsSync(BIN_DIR)) {
  obfuscateFiles(BIN_DIR);
  console.log("✅ Archivos JS ofuscados en /bin");
} else {
  console.log("⚠️ No existe /bin, salteando...");
}
