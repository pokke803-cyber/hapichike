const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of ["index.html", "homecasino.html.txt", "README.md"]) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

console.log("Static site ready in dist/");
