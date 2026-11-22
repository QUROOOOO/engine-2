/**
 * Vercel Build Script for QuantumOrbit Simulator
 * Compiles TypeScript + Vite bundle from outputs/sim into public/ for instant global CDN delivery.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const simDir = path.join(rootDir, 'outputs', 'sim');
const distDir = path.join(simDir, 'dist');
const publicDir = path.join(rootDir, 'public');

console.log('[Vercel Build] Starting QuantumOrbit build...');
console.log(`[Vercel Build] Root directory: ${rootDir}`);
console.log(`[Vercel Build] Simulator directory: ${simDir}`);

// Helper to run commands
function run(cmd, cwd = rootDir) {
  console.log(`[Vercel Build] Running: ${cmd} (in ${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
}

// 1. Detect package manager
let pkgManager = 'npm';
try {
  execSync('pnpm --version', { stdio: 'ignore' });
  pkgManager = 'pnpm';
} catch {
  pkgManager = 'npm';
}
console.log(`[Vercel Build] Using package manager: ${pkgManager}`);

// 2. Install dependencies in outputs/sim if needed
if (!fs.existsSync(path.join(simDir, 'node_modules'))) {
  console.log('[Vercel Build] Installing outputs/sim dependencies...');
  if (pkgManager === 'pnpm') {
    run('pnpm install --frozen-lockfile=false', simDir);
  } else {
    run('npm install', simDir);
  }
}

// 3. Build outputs/sim
console.log('[Vercel Build] Building outputs/sim Vite bundle...');
if (pkgManager === 'pnpm') {
  run('pnpm run build', simDir);
} else {
  run('npm run build', simDir);
}

// 4. Ensure public directory exists and clean old assets
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Helper to copy directory recursively
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// 5. Copy dist contents to public/
console.log('[Vercel Build] Copying built assets from outputs/sim/dist to public/...');
copyRecursive(distDir, publicDir);

// 6. Copy interactive plots if available
const plotsDir = path.join(rootDir, 'outputs', 'plots');
if (fs.existsSync(plotsDir)) {
  console.log('[Vercel Build] Copying outputs/plots to public/plots/...');
  copyRecursive(plotsDir, path.join(publicDir, 'plots'));
}

console.log('[Vercel Build] Build completed successfully! Contents of public/:');
try {
  const publicEntries = fs.readdirSync(publicDir);
  console.log(' - ' + publicEntries.join('\n - '));
} catch (e) {
  console.warn('[Vercel Build] Could not list public directory:', e.message);
}
