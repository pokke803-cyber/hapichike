const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of ["index.html", "homecasino.html.txt", "README.md"]) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

const publicDir = path.join(root, "public");
if (fs.existsSync(publicDir)) {
  copyDir(publicDir, path.join(dist, "public"));
}

console.log("Static site ready in dist/");
