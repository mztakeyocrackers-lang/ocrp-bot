# OCRP Universal Bot

This is the OCRP multi-guild operations bot for:
- patrol logging
- arrest logging
- promotions
- demotions
- blacklists

The bot is intentionally separate from the SAVE bot stack. It uses:
- a new Discord bot identity
- a new OCRP Supabase project
- a per-guild OCRP dashboard for configuration

## Commands

V1 deploys:
- `/patrol`
- `/arrest`
- `/promotion`
- `/demotion`
- `/blacklist`

## Environment

Copy `.env.example` to `.env` and fill in:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID` for local guild-only testing, or leave blank for global deploys
- `OCRP_SUPABASE_URL`
- `OCRP_SUPABASE_SERVICE_ROLE_KEY`

## Setup

1. Install dependencies:
   - `npm install`
2. Deploy commands:
   - `npm run deploy`
3. Start the bot:
   - `npm start`

## Notes

- Guild-specific command access is controlled in the OCRP dashboard and stored in the OCRP database.
- Discord messages are mirrors only; the database is the source of truth.
