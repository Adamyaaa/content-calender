const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8080;
const DB_FILE = path.join(__dirname, 'calendar.db');

// Initialize SQLite Database
const db = new DatabaseSync(DB_FILE);

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT,
    platform TEXT,
    pillar TEXT,
    date TEXT,
    time TEXT,
    status TEXT,
    assignee TEXT,
    copy TEXT,
    asset TEXT,
    cta TEXT,
    hashtags TEXT,
    url TEXT,
    impressions INTEGER DEFAULT 0,
    engagements INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ SQLite Database initialized at:', DB_FILE);

// Default settings if empty
const checkSettings = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings');
if (!checkSettings) {
  const defaultSettings = JSON.stringify({
    companyName: "My Company ContentOps",
    niche: "Growth Marketing",
    tagline: "Master Company Content Calendar & Publishing Command Center",
    teamMembers: ["Me (Owner)", "Writer / Designer", "Reviewer / Lead"]
  });
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_settings', defaultSettings);
}

// Helpers
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // API ROUTES
  if (pathname === '/api/health') {
    return sendJson(res, 200, { status: 'healthy', database: 'sqlite', timestamp: new Date().toISOString() });
  }

  if (pathname === '/api/posts') {
    if (method === 'GET') {
      const rows = db.prepare('SELECT * FROM posts ORDER BY date ASC, time ASC').all();
      return sendJson(res, 200, rows);
    }

    if (method === 'POST') {
      try {
        const p = await parseJsonBody(req);
        if (!p.id || !p.title) {
          return sendJson(res, 400, { error: 'Post ID and Title are required' });
        }

        const stmt = db.prepare(`
          INSERT INTO posts (id, title, platform, pillar, date, time, status, assignee, copy, asset, cta, hashtags, url, impressions, engagements)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            platform = excluded.platform,
            pillar = excluded.pillar,
            date = excluded.date,
            time = excluded.time,
            status = excluded.status,
            assignee = excluded.assignee,
            copy = excluded.copy,
            asset = excluded.asset,
            cta = excluded.cta,
            hashtags = excluded.hashtags,
            url = excluded.url,
            impressions = excluded.impressions,
            engagements = excluded.engagements
        `);

        stmt.run(
          p.id,
          p.title,
          p.platform || 'LinkedIn',
          p.pillar || 'Educational',
          p.date || new Date().toISOString().split('T')[0],
          p.time || '09:00',
          p.status || 'Idea',
          p.assignee || '',
          p.copy || '',
          p.asset || 'Single Image / Infographic',
          p.cta || '',
          p.hashtags || '',
          p.url || '',
          Number(p.impressions) || 0,
          Number(p.engagements) || 0
        );

        return sendJson(res, 200, { success: true, post: p });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  if (pathname.startsWith('/api/posts/')) {
    const postId = pathname.replace('/api/posts/', '');

    if (postId === 'clear' && method === 'POST') {
      db.prepare('DELETE FROM posts').run();
      return sendJson(res, 200, { success: true, message: 'All posts cleared' });
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
      return sendJson(res, 200, { success: true, deletedId: postId });
    }
  }

  if (pathname === '/api/settings') {
    if (method === 'GET') {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings');
      return sendJson(res, 200, row ? JSON.parse(row.value) : {});
    }

    if (method === 'POST') {
      try {
        const newSettings = await parseJsonBody(req);
        db.prepare(`
          INSERT INTO settings (key, value) VALUES ('app_settings', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(JSON.stringify(newSettings));
        return sendJson(res, 200, { success: true, settings: newSettings });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  // STATIC FILE SERVING
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      return res.end('Server Error loading file');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Content Calendar Server & Database live on http://localhost:${PORT}`);
});
