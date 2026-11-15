// Current Affairs moved to aivorah-world-and-you-service. Old app versions
// still call this service's /current-affairs/*, so those calls are forwarded
// there unchanged: same method, path, query string, body and Authorization
// header; the answer (status, body, content type) comes back unchanged. No
// redirect, so POSTs and the student's sign-in keep working.
//
// WORLD_AND_YOU_SERVICE_URL is the World & You service's base URL
// (default http://localhost:3010 for local development).
const express = require('express');

const DEFAULT_TARGET = 'http://localhost:3010';
// World & You can be asleep on Render: give it time to wake up.
const TIMEOUT_MS = parseInt(process.env.CURRENT_AFFAIRS_PROXY_TIMEOUT_MS || '90000', 10);

const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'accept-language', 'user-agent'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

function targetBase() {
  return (process.env.WORLD_AND_YOU_SERVICE_URL || DEFAULT_TARGET).replace(/\s+/g, '').replace(/\/+$/, '');
}

function currentAffairsProxy({ fetchImpl = (...args) => fetch(...args) } = {}) {
  const router = express.Router();
  // The raw body, byte for byte (mounted before the app's JSON parser).
  router.use(express.raw({ type: () => true, limit: '1mb' }));

  router.use(async (req, res) => {
    const url = `${targetBase()}${req.originalUrl}`; // originalUrl = /current-affairs/... with its query
    const headers = {};
    for (const name of FORWARD_REQUEST_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
    const forwardedFor = [req.headers['x-forwarded-for'], req.ip].filter(Boolean).join(', ');
    if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
    const hasBody = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0;

    let upstream;
    try {
      upstream = await fetchImpl(url, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`[current-affairs proxy] ${req.method} ${url}:`, err.message);
      return res.status(502).json({ error: 'Could not load current affairs right now. Please try again.' });
    }

    res.status(upstream.status);
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.set(name, value);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  return router;
}

module.exports = { currentAffairsProxy, targetBase, DEFAULT_TARGET };
