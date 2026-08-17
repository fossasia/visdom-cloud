/* Copyright 2017-present, The Visdom Authors */

// Scenario 3 - cold visdom page load.
//
// Every request under /vis/ passes the nginx auth gate, which calls the gateway's
// /auth/verify and caches the answer per credential for 30 seconds. That window is
// also how long a logged-out session keeps working, so we want it short. What
// shortening it costs is one extra verify per page load, so this run pays that cost
// on every iteration and reports it beside the page itself: if verify stays cheap
// while page loads climb, the window can come down.
//
// Cold means no browser cache, which is the first visit and the case that decides
// whether the gate is felt. Assets are read out of the served HTML rather than
// hardcoded, so the run follows whatever the visdom build actually ships.
//
//   BENCH_USERS      distinct sessions to hold (default 10)
//   BENCH_RATES      comma-separated page loads/sec stages (default 5,10,25,50,100)
//   BENCH_STAGE      seconds per stage (default 30)
//   BENCH_WORKSPACE  slug prefix, one workspace per session (default k6-cold)

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  BASE,
  NO_REQUESTS,
  arrivalOptions,
  cookieFor,
  dropped,
  ensureWorkspace,
  failed,
  intEnv,
  noRequests,
  openSessions,
  ratesEnv,
  recordFailure,
  registerUsers,
  settle,
  trend,
} from './lib.js';

const USERS = intEnv('BENCH_USERS', 10);
const RATES = ratesEnv('5,10,25,50,100');
const STAGE = intEnv('BENCH_STAGE', 30);
const WORKSPACE = __ENV.BENCH_WORKSPACE || 'k6-cold';
const MAX_ASSETS = 40;

const pageTime = new Trend('page_time', true);
const verifyTime = new Trend('verify_time', true);
const assetTime = new Trend('asset_time', true);
const assetsFetched = new Counter('assets_fetched');

export const options = arrivalOptions('coldload', RATES, STAGE);

function normalize(path) {
  const parts = [];
  path.split('/').forEach((segment) => {
    if (segment === '' || segment === '.') {
      return;
    }
    if (segment === '..') {
      parts.pop();
    } else {
      parts.push(segment);
    }
  });
  return `/${parts.join('/')}`;
}

function assetPaths(html) {
  const found = new Set();
  const pattern = /(?:src|href)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match = pattern.exec(html);
  while (match !== null && found.size < MAX_ASSETS) {
    const path = match[1] || match[2] || match[3];
    if (path && path.startsWith('/')) {
      found.add(normalize(path));
    }
    match = pattern.exec(html);
  }
  return Array.from(found);
}

export function setup() {
  settle();
  const sessions = openSessions(registerUsers('cold', USERS)).map((session, i) => ({
    ...session,
    slug: ensureWorkspace(session, `${WORKSPACE}-${i}`),
  }));

  const first = sessions[0];
  const res = http.get(`${BASE}/vis/w/${first.slug}/`, { headers: cookieFor(first) });
  if (res.status !== 200) {
    throw new Error(`loading /vis/w/${first.slug}/ failed: ${res.status} ${res.body}`);
  }
  const assets = assetPaths(res.body);
  if (assets.length === 0) {
    throw new Error('no assets found in the visdom page; the gate may be serving a redirect');
  }

  return { sessions, assets };
}

export default function (data) {
  const session = data.sessions[Math.floor(Math.random() * data.sessions.length)];
  const headers = cookieFor(session);

  const verify = http.get(`${BASE}/api/v1/auth/verify`, { headers, tags: { name: 'verify' } });
  verifyTime.add(verify.timings.duration);

  const page = http.get(`${BASE}/vis/w/${session.slug}/`, { headers, tags: { name: 'page' } });
  pageTime.add(page.timings.duration);

  const requests = data.assets.map((path) => ['GET', `${BASE}${path}`, null, { headers }]);
  const assets = http.batch(requests);
  assets.forEach((res) => {
    assetTime.add(res.timings.duration);
    recordFailure(res);
  });
  assetsFetched.add(assets.length);

  recordFailure(verify);
  recordFailure(page);
  check(page, { 'page served': (r) => r.status === 200 });
  check(verify, { 'session accepted': (r) => r.status === 200 });
}

export function handleSummary(data) {
  if (noRequests(data)) {
    return NO_REQUESTS;
  }

  const page = trend(data, 'page_time');
  const verify = trend(data, 'verify_time');
  const asset = trend(data, 'asset_time');
  const loads = data.metrics.iterations.values;
  const fetched = data.metrics.assets_fetched ? data.metrics.assets_fetched.values.count : 0;

  const row = [
    Math.floor(Date.now() / 1000),
    3,
    USERS,
    RATES[RATES.length - 1],
    loads.count ? Math.round(fetched / loads.count) : 0,
    loads.count,
    loads.rate.toFixed(1),
    page.med.toFixed(1),
    page['p(95)'].toFixed(1),
    verify.med.toFixed(1),
    verify['p(95)'].toFixed(1),
    asset['p(95)'].toFixed(1),
    failed(data),
    dropped(data),
  ].join(',');

  return { stdout: `${row}\n` };
}

export const WATCH = 'gateway=uvicorn db=postgres: visdom=visdom.server';

export const CSV_HEADER = 'ts,scenario,users,peak_rate,assets,loads,throughput,page_p50_ms,page_p95_ms,verify_p50_ms,verify_p95_ms,asset_p95_ms,errors,dropped';
