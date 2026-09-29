// Tiny static server for the site folder (docs/).  node serve.cjs [port]   -> http://localhost:8081/
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const port = +process.argv[2] || 8081, root = path.join(__dirname, 'docs');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  });
}).listen(port, '0.0.0.0', () => {
  console.log('Serving ' + root + ' on port ' + port);
  Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).forEach((i) => console.log('  phone URL: http://' + i.address + ':' + port + '/'));
});
