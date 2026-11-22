// Petit serveur de fichiers pour les tests du site (aucune dépendance).
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const racine = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json" };
http.createServer((req, res) => {
  let p = path.normalize(path.join(racine, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!p.startsWith(racine)) { res.writeHead(403); return res.end(); }
  if (p.endsWith(path.sep)) p += "index.html";
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  });
}).listen(Number(process.env.PORT || 4173), () => console.log("site de test prêt"));
