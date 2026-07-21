# Visdom Cloud — Tester Quickstart

A hosted, multi-tenant visdom for live experiment visualization. Your training
code runs on **your** machine and streams plots to a shared server; you view them
in the browser. Everything is isolated per **workspace**.

> Replace `visdom-test.<your-domain>` below with the real deployment URL.

## 1. Make an account + workspace
1. Open **https://visdom-test.<your-domain>** and **Register** (or log in).
2. Create a **workspace** — note its **slug** (e.g. `team-alpha`).

## 2. Get an API key
- In the console, open the **Keys** tab → **Create key**.
- Copy it now — it is shown only once. (Org-scoped works for any of your
  workspaces; workspace-scoped is bound to one.)

## 3. Install the client
The hosted server needs the client that sends your key + workspace:
```bash
pip install "git+https://github.com/vedansh-5/visdom.git@dev"
```
> Plain `pip install visdom` will **not** work here — it has no key/workspace support.

## 4. Send some plots — this is how an "environment" is created
An **environment** is created automatically the first time you write to it. There
is no "new env" button and no server terminal — you just pass `env="<name>"` from
your own code.
```python
import visdom

vis = visdom.Visdom(
    server="https://visdom-test.<your-domain>", port=443, base_url="/vis",
    api_key="visdom_live_...",   # your key from step 2
    workspace="team-alpha",      # your workspace slug (required when a key is set)
)

# The env "experiment-1" is created in your workspace and plotted into:
for step, loss in enumerate([0.9, 0.6, 0.4, 0.25]):
    vis.line(X=[step], Y=[loss], win="loss", update="append",
             env="experiment-1", opts={"title": "training loss"})

vis.text("hello from my first run", env="experiment-1")
```

## 5. View them
Back in the console, open your workspace → **Open Visualizations**. You land in the
visdom UI at `/vis/w/team-alpha/`, and **experiment-1** appears in the environment
list, updating live. You only ever see your own workspace's environments.

## Troubleshooting
- **401 / "invalid key"** — key typo or it was revoked. Regenerate in the Keys tab.
- **"workspace is required"** — you set `api_key` but not `workspace`; add the slug.
- **Nothing shows in the UI** — confirm you opened *your* workspace's link
  (`/vis/w/<your-slug>/`) and that the script printed no errors.
- **Env in the wrong place** — the `workspace=` in your script must match the
  workspace you are viewing.

## Notes
- Use throwaway data and accounts during testing.
- One key can drive many environments — just write to different `env=` names.
