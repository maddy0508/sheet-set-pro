#!/usr/bin/env node
/**
 * Local-only shim: supabase-js (and Supabase itself) serves PostgREST under /rest/v1,
 * while a bare PostgREST process serves at the root. This forwards /rest/v1/* to it so
 * the integration suite exercises the client exactly as the browser does.
 *
 *   node scripts/postgrest-proxy.mjs <listenPort> <targetPort> [listenHost]
 */
import http from 'node:http';

const listenPort = Number(process.argv[2] ?? 3111);
const targetPort = Number(process.argv[3] ?? 3112);
const listenHost = process.argv[4] ?? '127.0.0.1';
const PREFIX = '/rest/v1';

const server = http.createServer((request, response) => {
  if (!request.url || !request.url.startsWith(PREFIX)) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Use /rest/v1/...' }));
    return;
  }

  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: targetPort,
      method: request.method,
      path: request.url.slice(PREFIX.length) || '/',
      headers: { ...request.headers, host: `127.0.0.1:${targetPort}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: `Upstream error: ${error.message}` }));
  });

  request.pipe(upstream);
});

server.listen(listenPort, listenHost);
