# Nginx reverse proxy (Milestone 3, item 1)

Collapses the three dev services behind a single origin so the console and visdom
share one session cookie — no CORS, no token hand-off.

| Path            | Upstream         | Port  |
| --------------- | ---------------- | ----- |
| `/`             | console frontend | 5173  |
| `/api/v1/*`     | console gateway  | 8085  |
| `/vis/*`        | visdom server    | 8097  |

Unified origin: **http://localhost:8080**

`/vis/*` is gated by an nginx `auth_request` subrequest to
`GET /api/v1/auth/verify`, which checks the `session_token` cookie the gateway
now sets at login/refresh. Unauthenticated requests are redirected to `/login`.

## Run the stack

Four processes, in order:

```sh
# 1. gateway
cd gateway && .venv/bin/python run.py

# 2. visdom server, mounted under the /vis prefix so its routes line up
python -m visdom.server --port 8097 --base_url /vis

# 3. console frontend
cd frontend && npm run dev

# 4. nginx (install first: `brew install nginx`)
nginx -c "$(pwd)/nginx/visdom-cloud.conf"
```

Validate the config before starting: `nginx -t -c "$(pwd)/nginx/visdom-cloud.conf"`.
Reload after edits: `nginx -s reload`. Stop: `nginx -s stop`.

Then open http://localhost:8080.
