const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function main() {
  const file = (...parts) => path.join(root, ...parts);
  const qr = await require('qrcode').toString('https://unclephilburt.github.io/AILExtensiion/', {type:'svg',margin:2});
  for (const target of [file('phone-web','public','phone-qr.svg'),file('extension','src','shared','phone-qr.svg')]) fs.writeFileSync(target, qr);
  for (const target of [file('phone-web','public','cloud-sync.js'),file('extension','src','shared','cloud-sync.js')]) fs.copyFileSync(file('src','cloud-sync.js'), target);
  await esbuild.build({ entryPoints: [file('src','auth-runtime.js')], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', outfile: file('phone-web','public','auth-runtime.js'), minify: true, legalComments: 'eof' });
  fs.copyFileSync(file('phone-web','public','auth-runtime.js'), file('extension','src','shared','auth-runtime.js'));
  await esbuild.build({ entryPoints: [file('src','account.js')], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', outfile: file('phone-web','public','account.js'), minify: true, legalComments: 'eof' });
  fs.mkdirSync(file('extension','src','account'), { recursive: true });
  await esbuild.build({ entryPoints: [file('src','admin.js')], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', outfile: file('phone-web','public','admin.js'), minify: true, legalComments: 'eof' });
  for (const name of ['account.js', 'account.html', 'account.css', 'admin.js', 'admin.html', 'admin.css']) {
    fs.copyFileSync(file('phone-web','public',name), file('extension','src','account',name));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
