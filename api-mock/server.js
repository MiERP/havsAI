const http = require('http');

const events = [];

function json(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (req.url === '/health') return json(res, 200, { ok: true });
    if (req.url === '/events' && req.method === 'POST') {
      try {
        const event = JSON.parse(body || '{}');
        events.push(event);
        console.log('event', JSON.stringify(event));
      } catch (error) {
        console.warn('bad event payload');
      }
      return json(res, 202, { ok: true });
    }
    if (req.url === '/events' && req.method === 'GET') return json(res, 200, events);
    if (req.url === '/billing/verify' && req.method === 'POST') {
      return json(res, 200, { ok: true, verified: true });
    }
    if (req.url && req.url.startsWith('/chat') && req.method === 'GET') {
      return json(res, 200, { reply: 'Mock tutor: let us solve it step by step.' });
    }
    return json(res, 404, { error: 'not found' });
  });
}).listen(8787, () => console.log('api-mock listening on http://localhost:8787'));
