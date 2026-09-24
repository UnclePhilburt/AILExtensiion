const esbuild = require('esbuild');
const fs = require('node:fs');
async function main() {
  const qr = await require('qrcode').toString('https://unclephilburt.github.io/AILExtensiion/', {type:'svg',margin:2});
  for (const target of ['phone-web/public/phone-qr.svg','extension/src/shared/phone-qr.svg']) fs.writeFileSync(target, qr);
  for (const target of ['phone-web/public/cloud-sync.js','extension/src/shared/cloud-sync.js']) fs.copyFileSync('src/cloud-sync.js', target);
  await esbuild.build({ entryPoints: ['src/auth-runtime.js'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', outfile: 'phone-web/public/auth-runtime.js', minify: true, legalComments: 'eof' });
  fs.copyFileSync('phone-web/public/auth-runtime.js', 'extension/src/shared/auth-runtime.js');
  await esbuild.build({ entryPoints: ['src/account.js'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', outfile: 'phone-web/public/account.js', minify: true, legalComments: 'eof' });
  fs.mkdirSync('extension/src/account', { recursive: true });
  for (const name of ['account.js', 'account.html', 'account.css']) {
    fs.copyFileSync(`phone-web/public/${name}`, `extension/src/account/${name}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
