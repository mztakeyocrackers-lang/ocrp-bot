# OCRP Universal Bot

The OCRP multi-guild operations bot for Official Chicago Roleplay. Handles operational logging, personnel management, disciplinary actions, and request workflows across all OCRP guilds from a single bot identity.

This bot is intentionally separate from the SAVE bot stack. It uses:
- A dedicated Discord bot identity
- A separate OCRP Supabase project
- A per-guild OCRP dashboard for all configuration

---

## Commands

### Operational
- `/patrol` — log a patrol session
- `/arrest` — log an arrest
- `/callout` — log a callout
- `/training` — log a training session
- `/ridealong` — log a ride-along

### Personnel
- `/promote` — promote a member
- `/demote` — demote a member
- `/hire` — log a new hire
- `/loa` — submit or log a leave of absence

### Disciplinary
- `/blacklist` — blacklist a member
- `/strike` — issue a strike
- `/terminate` — log a termination

### Requests
- `/rolerequest` — submit a role request
- `/joinrequest` — submit a join request

> Command access is controlled per-guild via the OCRP dashboard. Each command maps to one or more Discord role IDs that are permitted to use it.

---

## Channel Configuration

Each guild configures its own set of log and notification channels via the dashboard. No channel IDs are hardcoded.

**Log channels** (set per guild in dashboard):
- Patrol log, arrest log, callout log, training log, ride-along log
- Promotion log, demotion log, hire log, LOA log
- Blacklist log, strike log, termination log

**Notification channels**:
- Role requests, join requests, applications
- Dashboard notices, announcements, welcome, activity feed

---

## Feature Toggles

Each module can be enabled or disabled per guild from the dashboard without redeploying. Disabled modules will not respond to commands or post to channels.

---

## Environment

Copy `.env.example` to `.env` and fill in:

```
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=               # local guild-only testing only; leave blank for global deploys
OCRP_SUPABASE_URL=
OCRP_SUPABASE_SERVICE_ROLE_KEY=
DASHBOARD_SESSION_SECRET=
DASHBOARD_DISCORD_CLIENT_ID=
DASHBOARD_DISCORD_CLIENT_SECRET=
DASHBOARD_DISCORD_REDIRECT_URI=
```

---

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Deploy slash commands:
   ```
   npm run deploy
   ```
3. Start the bot:
   ```
   npm start
   ```

---

## Dashboard

The OCRP control dashboard is an internal web UI for managing guild deployments. It is not publicly accessible.

From the dashboard, operators can:
- Assign log and notification channel IDs per guild
- Map Discord role IDs to each bot command
- Enable or disable feature modules per guild
- Manage operator role access (operator / command / director)
- Browse operational records by guild and type
- View a full audit log of dashboard writes and bot-side actions

Dashboard access is role-based and scoped per guild. Operators sign in with Discord OAuth.

---

## Notes

- The database is the source of truth. Discord messages are mirrors only.
- Guild configs, operator roles, and records are fully isolated per guild.
- All configuration is stored in the OCRP Supabase project, not in environment variables or local files.
