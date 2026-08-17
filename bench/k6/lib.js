/* Copyright 2017-present, The Visdom Authors */

// Shared setup for the k6 gateway scenarios.
//
// Every scenario needs the same three things before it can measure anything:
// accounts that exist, sessions to carry, and a gateway that is not still draining
// from the previous run. Keeping them here means a fix to any of the three lands in
// every scenario at once.

import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';

export const BASE = __ENV.BENCH_BASE || 'http://proxy';
export const PASSWORD = 'benchmark-password';

export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'];

export function intEnv(name, fallback) {
  return parseInt(__ENV[name] || String(fallback), 10);
}

export function ratesEnv(fallback) {
  return (__ENV.BENCH_RATES || fallback).split(',').map(Number);
}

export function arrivalOptions(name, rates, stage) {
  return {
    scenarios: {
      [name]: {
        executor: 'ramping-arrival-rate',
        startRate: rates[0],
        timeUnit: '1s',
        preAllocatedVUs: 50,
        maxVUs: 400,
        stages: rates.map((rate) => ({ target: rate, duration: `${stage}s` })),
      },
    },
    thresholds: { checks: ['rate>0.99'] },
    setupTimeout: '10m',
    summaryTrendStats: SUMMARY_TREND_STATS,
  };
}

export function email(prefix, i) {
  return `k6-${prefix}-${i}@example.com`;
}

export function registerUsers(prefix, count) {
  const users = [];
  for (let i = 0; i < count; i += 1) {
    const address = email(prefix, i);
    const res = http.post(
      `${BASE}/api/v1/auth/register`,
      JSON.stringify({ email: address, password: PASSWORD }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (res.status !== 201 && res.status !== 400) {
      throw new Error(`seeding ${address} failed: ${res.status} ${res.body}`);
    }
    users.push(address);
  }
  return users;
}

export function openSessions(users) {
  return users.map((address) => {
    const res = http.post(`${BASE}/api/v1/auth/login`, {
      username: address,
      password: PASSWORD,
    });
    if (res.status !== 200) {
      throw new Error(`login ${address} failed: ${res.status} ${res.body}`);
    }
    return { email: address, token: res.json('access_token') };
  });
}

export function cookieFor(session) {
  return { Cookie: `session_token=${session.token}` };
}

export function bearerFor(session) {
  return { Authorization: `Bearer ${session.token}` };
}

export function ensureWorkspace(session, slug) {
  const res = http.post(
    `${BASE}/api/v1/workspaces`,
    JSON.stringify({ name: slug, slug }),
    { headers: { 'Content-Type': 'application/json', ...bearerFor(session) } }
  );
  if (res.status !== 201 && res.status !== 400) {
    throw new Error(`creating workspace ${slug} failed: ${res.status} ${res.body}`);
  }
  return slug;
}

export function settle(timeoutSeconds = 180, quickMs = 500) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let quick = 0;
  while (Date.now() < deadline) {
    const started = Date.now();
    const res = http.get(`${BASE}/api/v1/health`, { timeout: '15s' });
    if (res.status === 200 && Date.now() - started < quickMs) {
      quick += 1;
      if (quick >= 3) {
        return;
      }
    } else {
      quick = 0;
    }
    sleep(1);
  }
  throw new Error(
    `gateway still slow after ${timeoutSeconds}s; it is probably draining a previous run`
  );
}

export function noRequests(data) {
  const iterations = data.metrics.iterations;
  return !data.metrics.http_reqs || !iterations || !iterations.values.count;
}

export const NO_REQUESTS = {
  stdout: 'k6: no requests completed, see the errors above\n',
};

export function trend(data, name) {
  const metric = data.metrics[name];
  if (!metric) {
    return { avg: 0, med: 0, max: 0, 'p(95)': 0, 'p(99)': 0 };
  }
  return metric.values;
}

export function dropped(data) {
  return data.metrics.dropped_iterations ? data.metrics.dropped_iterations.values.count : 0;
}

const failures = new Counter('workload_failures');

export function recordFailure(res) {
  if (res.status === 0 || res.status >= 400) {
    failures.add(1);
  }
}

export function failed(data) {
  return data.metrics.workload_failures ? data.metrics.workload_failures.values.count : 0;
}
