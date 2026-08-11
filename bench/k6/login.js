// Scenario 1 - login storm.
//
// Every login runs bcrypt at cost factor 12 (gensalt() default), which is a few
// hundred milliseconds of CPU by design. That makes logins far more expensive than
// anything measured so far, and the gateway is a single service that does not shard,
// so this is a candidate for the real ceiling of the whole platform rather than of
// visdom.
//
// An open model on purpose: arrival rate is held regardless of how slow the server
// gets, so a saturated gateway shows up as rising latency and dropped iterations
// rather than as VUs politely waiting. A closed model would hide the knee.
//
//   BENCH_USERS   accounts to seed and log in as (default 20)
//   BENCH_RATES   comma-separated logins/sec stages (default 2,5,10,20,40)
//   BENCH_STAGE   seconds per stage (default 30)

import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BENCH_BASE || 'http://proxy';
const USERS = parseInt(__ENV.BENCH_USERS || '20', 10);
const RATES = (__ENV.BENCH_RATES || '2,5,10,20,40').split(',').map(Number);
const STAGE = parseInt(__ENV.BENCH_STAGE || '30', 10);
const PASSWORD = 'benchmark-password';

export const options = {
  scenarios: {
    login: {
      executor: 'ramping-arrival-rate',
      startRate: RATES[0],
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: RATES.map((rate) => ({ target: rate, duration: `${STAGE}s` })),
    },
  },
  // A run of denials would report a throughput that measures nothing, so fail loudly.
  thresholds: {
    checks: ['rate>0.99'],
  },
};

function email(i) {
  return `k6-login-${i}@bench.local`;
}

export function setup() {
  const created = [];
  for (let i = 0; i < USERS; i += 1) {
    const payload = JSON.stringify({ email: email(i), password: PASSWORD });
    const res = http.post(`${BASE}/api/v1/auth/register`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    // 400 means the account survived an earlier run, which is fine to reuse.
    if (res.status !== 201 && res.status !== 400) {
      throw new Error(`seeding ${email(i)} failed: ${res.status} ${res.body}`);
    }
    created.push(email(i));
  }
  return { users: created };
}

export default function (data) {
  const user = data.users[Math.floor(Math.random() * data.users.length)];
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    { username: user, password: PASSWORD },
    { tags: { name: 'login' } }
  );
  check(res, { 'login 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const d = data.metrics.http_req_duration.values;
  const reqs = data.metrics.http_reqs.values;
  const failed = data.metrics.http_req_failed.values.passes || 0;
  const dropped = data.metrics.dropped_iterations
    ? data.metrics.dropped_iterations.values.count
    : 0;

  const row = [
    Math.floor(Date.now() / 1000),
    1,
    USERS,
    RATES[RATES.length - 1],
    reqs.count,
    reqs.rate.toFixed(1),
    d.med.toFixed(1),
    d['p(95)'].toFixed(1),
    d['p(99)'].toFixed(1),
    d.max.toFixed(1),
    failed,
    dropped,
  ].join(',');

  return {
    stdout: `${row}\n`,
    'summary.json': JSON.stringify(data),
  };
}

export const CSV_HEADER =
  'ts,scenario,users,peak_rate,requests,throughput,p50_ms,p95_ms,p99_ms,max_ms,errors,dropped';
