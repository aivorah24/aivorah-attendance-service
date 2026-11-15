// Old app versions call /current-affairs on this service; it forwards them to
// aivorah-world-and-you-service unchanged. A stand-in World & You server runs
// on a random local port and records what reaches it.
jest.mock('../../services/supabase', () => ({ from: jest.fn() }));
jest.mock('../../services/firebaseAdmin', () => null);

const http = require('http');
const express = require('express');
const request = require('supertest');

let worldAndYou;
let received;
let app;

beforeAll(async () => {
  const target = express();
  target.use(express.raw({ type: () => true }));
  target.all('*', (req, res) => {
    received.push({
      method: req.method, url: req.originalUrl, authorization: req.headers.authorization,
      contentType: req.headers['content-type'], body: Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '',
    });
    if (req.path === '/current-affairs/redirect-me') return res.redirect(302, '/elsewhere');
    if (req.path === '/current-affairs/progress/kid%40school.in') return res.status(403).json({ error: 'You can only see or change your own progress' });
    res.set('Cache-Control', 'no-store').json({ servedBy: 'world-and-you', path: req.path });
  });
  worldAndYou = http.createServer(target);
  await new Promise((resolve) => worldAndYou.listen(0, '127.0.0.1', resolve));
  process.env.WORLD_AND_YOU_SERVICE_URL = `http://127.0.0.1:${worldAndYou.address().port}/`;
  app = require('../../index');
});

afterAll(async () => {
  delete process.env.WORLD_AND_YOU_SERVICE_URL;
  await new Promise((resolve) => worldAndYou.close(resolve));
});

beforeEach(() => { received = []; });

test('GET /current-affairs/digest/today reaches World & You with its query', async () => {
  const res = await request(app).get('/current-affairs/digest/today?ageGroup=8-12&studentEmail=kid%40school.in')
    .set('Authorization', 'Bearer student-token');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ servedBy: 'world-and-you', path: '/current-affairs/digest/today' });
  expect(res.headers['cache-control']).toBe('no-store');
  expect(received).toEqual([{
    method: 'GET', url: '/current-affairs/digest/today?ageGroup=8-12&studentEmail=kid%40school.in',
    authorization: 'Bearer student-token', contentType: undefined, body: '',
  }]);
});

test('a POST body and the Authorization header are forwarded unchanged', async () => {
  const body = '{"studentEmail":"kid@school.in","ageGroup":"13+","answers":[{"questionId":"q1","answer":2}]}';
  const res = await request(app).post('/current-affairs/quiz/submit')
    .set('Authorization', 'Bearer t-2').set('Content-Type', 'application/json').send(body);
  expect(res.status).toBe(200);
  expect(received[0]).toEqual({
    method: 'POST', url: '/current-affairs/quiz/submit', authorization: 'Bearer t-2',
    contentType: 'application/json', body,
  });
});

test("World & You's status and error come back as they are", async () => {
  const res = await request(app).get('/current-affairs/progress/kid%40school.in');
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ error: 'You can only see or change your own progress' });
});

test('a redirect from World & You is passed back, not followed', async () => {
  const res = await request(app).get('/current-affairs/redirect-me');
  expect(res.status).toBe(302);
  expect(received).toHaveLength(1);
});

test('World & You unreachable → 502 with a friendly message', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  const saved = process.env.WORLD_AND_YOU_SERVICE_URL;
  process.env.WORLD_AND_YOU_SERVICE_URL = 'http://127.0.0.1:1';
  try {
    const res = await request(app).get('/current-affairs/digest/today?ageGroup=7-12');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/current affairs/i);
  } finally {
    process.env.WORLD_AND_YOU_SERVICE_URL = saved;
    error.mockRestore();
  }
});

test('the rest of the attendance service still parses JSON as before', async () => {
  const res = await request(app).get('/health');
  expect(res.body).toEqual({ status: 'ok', service: 'aivorah-attendance-service' });
  expect(received).toHaveLength(0);
});

test('default target is the local World & You port', () => {
  const { targetBase } = require('../../routes/currentAffairsProxy');
  const saved = process.env.WORLD_AND_YOU_SERVICE_URL;
  delete process.env.WORLD_AND_YOU_SERVICE_URL;
  try {
    expect(targetBase()).toBe('http://localhost:3010');
  } finally {
    process.env.WORLD_AND_YOU_SERVICE_URL = saved;
  }
});
