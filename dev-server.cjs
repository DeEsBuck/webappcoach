const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const coachHandler = require('./api/coach');
const maxRequestSize = 16 * 1024;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxRequestSize) {
      throw Object.assign(new Error('Anfrage ist zu groß.'), { status: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Ungültiges JSON.'), { status: 400 });
  }
}

function createFunctionResponse(res) {
  const response = {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(statusCode) {
      res.statusCode = statusCode;
      return this;
    },
    json(data) {
      sendJson(res, res.statusCode || 200, data);
      return this;
    }
  };
  return response;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/coach') {
    try {
      if (req.method !== 'POST') {
        return await coachHandler(req, createFunctionResponse(res));
      }

      if (!process.env.GEMINI_API_KEY) {
        return sendJson(res, 500, {
          error: 'GEMINI_API_KEY fehlt. Lege den Schlüssel in .env.local ab und starte den Dev-Server neu.'
        });
      }

      req.body = await readJson(req);
      return await coachHandler(req, createFunctionResponse(res));
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      return sendJson(res, error.status || 500, {
        error: error.status ? error.message : 'Die lokale KI-Anfrage ist fehlgeschlagen.'
      });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end('Ungültiger Pfad.');
  }

  if (pathname === '/') pathname = '/index.html';

  const filePath = path.resolve(root, `.${pathname}`);
  const relativePath = path.relative(root, filePath);
  const pathParts = relativePath.split(path.sep);
  const isAllowedFile = pathParts.length === 1
    ? path.extname(relativePath).toLowerCase() === '.html'
    : ['css', 'img', 'js'].includes(pathParts[0]);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    !isAllowedFile ||
    pathParts.some(part => part.startsWith('.'))
  ) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }

    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream'
    });

    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(3000, '127.0.0.1', () => {
  console.log('Dev-Server: http://localhost:3000/appcoach.html');
});