// Runs before `npm install` and `npm run dev`. Vite's native build is skipped
// by npm on older Node versions, which otherwise fails later with a cryptic
// "Cannot find native binding" error. Say what is wrong, and how to fix it.
// Keep in step with "engines" in package.json.
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = (major === 22 && minor >= 12) || major === 24 || major >= 26;

if (!supported) {
  // 23 and 25 are newer than 22.12, so "too old" alone would confuse.
  const note = major === 23 || major === 25 ? ', a short-term release that is no longer supported' : '';
  console.error(`
  Control needs Node.js 22.12 or newer (24 LTS recommended). This computer has ${process.version}${note}.

  To fix it:
    1. Install the current LTS: on Windows run   winget install OpenJS.NodeJS.LTS
       (or download it from https://nodejs.org)
    2. Open a new terminal, check with   node -v
    3. Delete the node_modules folder and run   npm install   again
`);
  process.exit(1);
}
