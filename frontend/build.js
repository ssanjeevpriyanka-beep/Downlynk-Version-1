const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Helper to recursively copy directories
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Remove existing dist folder if present
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('Removed existing dist/ folder.');
}

// 2. Create new dist folder
fs.mkdirSync(distDir, { recursive: true });
console.log('Created dist/ folder.');

// 3. Copy index.html
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(distDir, 'index.html'));
console.log('Copied index.html to dist/.');

// 4. Copy css/, js/, images/
const dirsToCopy = ['css', 'js', 'images'];
for (const dir of dirsToCopy) {
  const srcPath = path.join(__dirname, dir);
  const destPath = path.join(distDir, dir);
  if (fs.existsSync(srcPath)) {
    copyDir(srcPath, destPath);
    console.log(`Copied ${dir}/ to dist/${dir}/.`);
  }
}

console.log('\nBuild complete successfully! All static assets copied to dist/.');
