/* Copyright 2017-present, The Visdom Authors */

// Scenario 2 - dashboard browse.
//
// What the console does when someone opens it and clicks around: who am I, which
// workspaces, then the tabs inside one of them. Every call is authenticated and every
// call reaches Postgres, so this is the gateway's read path rather than visdom's.
//
// It matters because the gateway is the one component that does not shard. Scenario 1
// measured logins, which are bcrypt bound and say nothing about the rest. This measures
// the part a logged-in user actually spends their time in.
//
// Each endpoint is timed separately, because the useful answer is not "the dashboard is
// slow" but which of the five calls is the one to fix.
//
//   BENCH_USERS   distinct sessions to browse as (default 10)
//   BENCH_RATES   comma-separated browse sequences/sec (default 5,10,25,50,100)
//   BENCH_STAGE   seconds per stage (default 30)

import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import {
  BASE,
  NO_REQUESTS,
  arrivalOptions,
  bearerFor,
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

const sequence = new Trend('browse_sequence', true);
const timings = {
  me: new Trend('call_me', true),
  workspaces: new Trend('call_workspaces', true),
  members: new Trend('call_members', true),
  keys: new Trend('call_keys', true),
  share: new Trend('call_share', true),
};

export const options = arrivalOptions('browse', RATES, STAGE);

function timedGet(label, path, headers) {
  const res = http.get(`${BASE}${path}`, { headers, tags: { name: label } });
  timings[label].add(res.timings.duration);
  recordFailure(res);
  return res;
}

export function setup() {
  settle();

  const sessions = openSessions(registerUsers('browse', USERS));
  const guest = sessions[0];

  sessions.forEach((session, i) => {
    const slug = ensureWorkspace(session, `k6-browse-${i}`);
    const headers = { 'Content-Type': 'application/json', ...bearerFor(session) };

    const listed = http.get(`${BASE}/api/v1/workspaces`, { headers: bearerFor(session) });
    const workspace = listed.json().find((ws) => ws.slug === slug);
    if (!workspace) {
      throw new Error(`workspace ${slug} missing from its owner's list`);
    }
    session.workspaceId = workspace.id;

    http.post(`${BASE}/api/v1/keys`, JSON.stringify({ name: `k6-${i}` }), { headers });
    http.post(
      `${BASE}/api/v1/workspaces/${workspace.id}/members`,
      JSON.stringify({ email: guest.email, role: 'viewer' }),
      { headers }
    );
    http.post(
      `${BASE}/api/v1/workspaces/${workspace.id}/share`,
      JSON.stringify({ role: 'viewer' }),
      { headers }
    );
  });

  return { sessions };
}

export default function (data) {
  const session = data.sessions[Math.floor(Math.random() * data.sessions.length)];
  const headers = bearerFor(session);
  const started = Date.now();

  timedGet('me', '/api/v1/auth/me', headers);
  const listed = timedGet('workspaces', '/api/v1/workspaces', headers);

  const id = session.workspaceId;
  timedGet('members', `/api/v1/workspaces/${id}/members`, headers);
  timedGet('keys', '/api/v1/keys', headers);
  timedGet('share', `/api/v1/workspaces/${id}/share`, headers);

  sequence.add(Date.now() - started);
  check(listed, { 'dashboard readable': (r) => r.status === 200 });
}

export function handleSummary(data) {
  if (noRequests(data)) {
    return NO_REQUESTS;
  }

  const seq = trend(data, 'browse_sequence');
  const browses = data.metrics.iterations.values;

  const row = [
    Math.floor(Date.now() / 1000),
    2,
    USERS,
    RATES[RATES.length - 1],
    browses.count,
    browses.rate.toFixed(1),
    seq.med.toFixed(1),
    seq['p(95)'].toFixed(1),
    trend(data, 'call_me')['p(95)'].toFixed(1),
    trend(data, 'call_workspaces')['p(95)'].toFixed(1),
    trend(data, 'call_members')['p(95)'].toFixed(1),
    trend(data, 'call_keys')['p(95)'].toFixed(1),
    trend(data, 'call_share')['p(95)'].toFixed(1),
    failed(data),
    dropped(data),
  ].join(',');

  return { stdout: `${row}\n` };
}

export const WATCH = 'gateway=uvicorn db=postgres:';

export const CSV_HEADER = 'ts,scenario,users,peak_rate,browses,throughput,seq_p50_ms,seq_p95_ms,me_p95_ms,workspaces_p95_ms,members_p95_ms,keys_p95_ms,share_p95_ms,errors,dropped';
