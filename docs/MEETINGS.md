# Video meetings (LiveKit)

**What it does:** anyone can meet anyone, 1-to-1 or group (up to 100 invitees).
- *Scheduled:* host sends a request → invitees Accept/Decline → at the time the host presses **Start** → accepted invitees get a notification and **Join**.
- *Instant:* host presses **Start instant call** → invitees get a "X is calling you" notification → joining = accepting.
- Host can add people mid-call, end for everyone, cancel, or delete from history. Reminders (10 min before; "time to start" for the host) run on the existing pg_cron job.
- Video, audio, screen share and in-call chat are provided by LiveKit's prebuilt room.

**Security:** the browser never holds a LiveKit secret. It asks the `meeting-token` Edge Function; that function asks the database (`meeting_join_check`, service-role only) whether the caller is the host or an invitee who accepted and the meeting is live. Tokens last 4 hours.

## One-time setup (Supabase dashboard + LiveKit dashboard)
1. SQL Editor (NEW project): run `far-tech-crm-update-0008.sql` once, after 0007.
2. LiveKit Cloud → your project → **Settings → Keys**: create an API key. Copy the **WebSocket URL** (`wss://….livekit.cloud`), **API Key** and **API Secret**.
3. Supabase → Edge Functions → **Secrets**, add: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
4. Supabase → Edge Functions → **Deploy a new function → Via Editor**, name it exactly `meeting-token`, paste `meeting-token-edge-function.ts`, Deploy. In Details turn **OFF** "Verify JWT with legacy secret".
5. Redeploy the website (new zip). Open **Meetings**.

Browsers need HTTPS for camera/microphone (Vercel provides it) and the user must click "Allow" on the permission prompt.
