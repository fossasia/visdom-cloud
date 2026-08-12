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
//   BENCH_RATES   comma-separated logins/sec stages (default 1,2,4,6,8,12)
//   BENCH_STAGE   seconds per stage (default 30)

import http from 'k6/http';
import { check } from 'k6';
import {
  BASE,
  NO_REQUESTS,
  PASSWORD,
  SUMMARY_TREND_STATS,
  dropped,
  failed,
  noRequests,
  recordFailure,
  registerUsers,
  settle,
  trend,
} from './lib.js';

const USERS = parseInt(__ENV.BENCH_USERS || '20', 10);
// Measured ceiling is around 5-6/s, so the useful range sits either side of that.
// Asking for 40/s only produced a 30s queue and told us nothing extra.
const RATES = (__ENV.BENCH_RATES || '1,2,4,6,8,12').split(',').map(Number);
const STAGE = parseInt(__ENV.BENCH_STAGE || '30', 10);

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
  // The threshold guards credentials, not speed. A run of 401s would report a
  // throughput that measures nothing and must fail; requests timing out because the
  // gateway is saturated are the result we came for and must not.
  thresholds: {
    checks: ['rate>0.99'],
  },
  // Seeding is bcrypt too, and it runs against a gateway that may still be busy, so
  // the default 60s is not enough headroom to distinguish slow from broken.
  setupTimeout: '10m',
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export function setup() {
  settle();
  return { users: registerUsers('login', USERS) };
}

export default function (data) {
  const user = data.users[Math.floor(Math.random() * data.users.length)];
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    { username: user, password: PASSWORD },
    { tags: { name: 'login' } }
  );
  recordFailure(res);
  check(res, { 'credentials accepted': (r) => r.status !== 401 && r.status !== 403 });
}

export function handleSummary(data) {
  if (noRequests(data)) {
    return NO_REQUESTS;
  }

  const d = trend(data, 'http_req_duration');
  const reqs = data.metrics.http_reqs.values;

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
    failed(data),
    dropped(data),
  ].join(',');

  // stdout only: /scripts is mounted read-only, and writing a file there fails the
  // run at the very end, after all the work is done.
  return { stdout: `${row}\n` };
}

export const WATCH = 'gateway=uvicorn db=postgres:';

export const CSV_HEADER = 'ts,scenario,users,peak_rate,requests,throughput,p50_ms,p95_ms,p99_ms,max_ms,errors,dropped';
