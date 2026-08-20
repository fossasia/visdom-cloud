/* Copyright 2017-present, The Visdom Authors */

import http from 'k6/http';
import { check } from 'k6';
import {
  BASE,
  NO_REQUESTS,
  PASSWORD,
  arrivalOptions,
  dropped,
  failed,
  intEnv,
  limited,
  noRequests,
  ratesEnv,
  recordFailure,
  registerUsers,
  settle,
  trend,
} from './lib.js';

const USERS = intEnv('BENCH_USERS', 20);
const RATES = ratesEnv('1,5,10,20,40');
const STAGE = intEnv('BENCH_STAGE', 30);

export const options = arrivalOptions('login', RATES, STAGE);

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
  check(res, { 'served or shed': (r) => r.status === 200 || r.status === 429 });
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
    limited(data),
    dropped(data),
  ].join(',');

  return { stdout: `${row}\n` };
}

export const WATCH = 'gateway=uvicorn db=postgres:';

export const CSV_HEADER = 'ts,scenario,users,peak_rate,requests,throughput,p50_ms,p95_ms,p99_ms,max_ms,errors,limited,dropped';
