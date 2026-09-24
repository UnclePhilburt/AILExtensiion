const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [keyPath, version, codebase, outputPath] = process.argv.slice(2);
if (!keyPath || !version || !codebase || !outputPath) throw new Error('Usage: node write-update-manifest.cjs <key> <version> <crx URL> <output XML>');
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
const publicDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const id = [...crypto.createHash('sha256').update(publicDer).digest().subarray(0, 16)]
  .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${id}">\n    <updatecheck codebase="${codebase}" version="${version}" />\n  </app>\n</gupdate>\n`;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, xml);
console.log(id);
