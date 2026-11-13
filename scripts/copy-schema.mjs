import { cpSync, mkdirSync, readdirSync } from "node:fs";

const source = "src/adapters/sqlite/migrations";
const target = "dist/adapters/sqlite/migrations";
mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  if (name.endsWith(".sql")) {
    cpSync(`${source}/${name}`, `${target}/${name}`);
  }
}

const fontDir = "dist/adapters/pdf";
mkdirSync(fontDir, { recursive: true });
cpSync("src/adapters/pdf/NotoSans-Regular.ttf", `${fontDir}/NotoSans-Regular.ttf`);
cpSync("src/adapters/pdf/OFL.txt", `${fontDir}/OFL.txt`);
