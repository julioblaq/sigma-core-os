import http from 'node:http';
import net from 'node:net';

const port = Number(process.env.PORT || 3000);
const upstream = new URL(process.env.HERMES_DASHBOARD_UPSTREAM || 'http://hermes-agent.railway.internal:9119');

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function forwardedHeaders(req) {
  const headers = { ...req.headers };

  for (const name of hopByHopHeaders) {
    delete headers[name];
  }

  headers.host = req.headers.host ?? upstream.host;
  headers['x-forwarded-host'] = req.headers.host ?? upstream.host;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-port'] = '443';

  const remoteAddress = req.socket.remoteAddress;
  if (remoteAddress) {
    headers['x-forwarded-for'] = headers['x-forwarded-for']
      ? `${headers['x-forwarded-for']}, ${remoteAddress}`
      : remoteAddress;
  }

  return headers;
}

const server = http.createServer((req, res) => {
  if (req.url === '/proxy-health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, upstream: upstream.origin }));
    return;
  }

  const proxyReq = http.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || 80,
    method: req.method,
    path: req.url,
    headers: forwardedHeaders(req),
  }, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    for (const name of hopByHopHeaders) {
      delete responseHeaders[name];
    }

    res.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    res.end(JSON.stringify({ ok: false, error: error.message }));
  });

  req.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  const upstreamSocket = net.connect(Number(upstream.port || 80), upstream.hostname, () => {
    const headers = forwardedHeaders(req);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade ?? 'websocket';

    const requestLines = [
      `${req.method} ${req.url} HTTP/${req.httpVersion}`,
      ...Object.entries(headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`),
      '',
      '',
    ];

    upstreamSocket.write(requestLines.join('\r\n'));
    if (head.length) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstreamSocket.on('error', () => socket.destroy());
  socket.on('error', () => upstreamSocket.destroy());
});

server.listen(port, '0.0.0.0', () => {
  console.log(`hermes-dashboard-proxy listening on ${port}, forwarding to ${upstream.origin}`);
});
