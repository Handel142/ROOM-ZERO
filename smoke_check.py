"""Static smoke checks for the ROOM ZERO frontend package."""
from html.parser import HTMLParser
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.assets, self.actions = set(), [], set()
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            assert attrs['id'] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs['id'])
        if tag == 'script' and attrs.get('src'):
            self.assets.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') in {'stylesheet', 'manifest', 'icon'}:
            self.assets.append(attrs.get('href'))
        if attrs.get('data-action'):
            self.actions.add(attrs['data-action'])

page = PageParser()
page.feed((ROOT / 'index.html').read_text(encoding='utf-8'))
for asset in page.assets:
    assert asset and (asset.startswith(('https://', 'http://')) or (ROOT / asset.split('?')[0]).is_file()), f'Missing linked asset: {asset}'
app = (ROOT / 'js/app.js').read_text(encoding='utf-8')
for action in sorted(page.actions):
    assert re.search(r"case\s+['\"]" + re.escape(action) + r"['\"]", app), f'No handler for page action: {action}'
required = ['index.html', 'css/styles.css', 'js/app.js', 'js/config.js', 'service-worker.js', 'manifest.webmanifest', 'supabase/schema.sql']
for item in required:
    assert (ROOT / item).is_file(), f'Missing required project file: {item}'
print(f'PASS: {len(page.actions)} page actions have handlers; {len(page.assets)} linked assets exist; required project files are present.')

# Regression checks for online room creation and minimum room size.
schema = (ROOT / 'supabase/schema.sql').read_text(encoding='utf-8')
assert 'get_byte(gen_random_bytes' not in schema, 'Room creation must not call pgcrypto.gen_random_bytes'
assert "substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'" in schema, 'Expected room-code generation to use the UI-safe alphabet'
assert "/^[A-Z0-9]{6}$/" in app, 'Join form must accept six-character alphanumeric legacy codes'
assert "replace(/[\\s-]/g, '')" in app, 'Join form must normalize copied spaces and hyphens'
assert 'p_capacity not between 2 and 50' in schema, 'Database must enforce a minimum capacity of 2'
assert '<option value="2" selected>2 players (minimum)</option>' in app, 'Room capacity must default to 2 players'
print('PASS: room-code SQL has no pgcrypto dependency; minimum room capacity is 2.')


# Regression checks for live chat refresh and server-authoritative multiplayer.
assert "state.syncTimer = window.setInterval(refreshOnlineRoom, 2200)" in app, "Online room polling fallback is required"
assert "room_messages" in app and ".subscribe()" in app, "Supabase Realtime subscriptions are required"
assert "db.rpc('start_room'" in app, "Online host start must call the start_room RPC"
assert "db.rpc('submit_room_answer'" in app, "Online answers must be recorded server-side"
assert "db.rpc('advance_room_question'" in app, "Host must advance the shared question through RPC"
assert "create or replace function public.start_room" in schema, "Missing host start RPC"
assert "create or replace function public.submit_room_answer" in schema, "Missing server-side answer RPC"
assert "create or replace function public.advance_room_question" in schema, "Missing shared question progression RPC"
assert "game_state jsonb" in schema, "Shared game state is required"
assert "public.room_answers" in schema, "Server-side answer storage is required"
assert "Only the room host can start the game" in schema, "Host-only start authorization is required"
assert "room-zero-shell-v4" in (ROOT / 'service-worker.js').read_text(encoding='utf-8'), "Service worker cache must be bumped"
print("PASS: online chat sync fallback, realtime subscriptions, host start, shared Brain Battle progression and cache version are present.")

assert "p_answer_index: Number(index)" in app and "p_correct_index" not in app, "Answer RPC must match the server-checked function signature"
assert "case 'resume-game'" in app, "Players must be able to return to an active match from the lobby"
print("PASS: multiplayer RPC argument contracts and active-game resume flow are consistent.")

assert "status in ('waiting','playing')" in schema, "Existing members must be able to reconnect to active rooms"
assert "answeredQuestionIndex" in app, "A reconnected player must restore current-question answer state"
assert "This game has already started; only players who were already in the room can reconnect" in schema, "Late joiners must not enter an active match"
print("PASS: reconnects to active games restore answer state and block late joiners.")

# v4 lobby regression checks
assert 'startButton.disabled = !isHost || room.members.length < 2' in app
assert 'data-role=\"start-hint\"' in app
assert 'Waiting for players: ${room.members.length} of ${room.capacity} joined' in app
assert "const selectedGame = 'brain';" in app
assert 'This mode is not playable yet. It cannot create a room' in app
assert 'room-zero-shell-v4' in (ROOT / 'service-worker.js').read_text(encoding='utf-8')
print('v4 lobby and preview regression checks passed')
assert 'count(distinct user_id)' in schema, 'Start RPC must count unique room members'
assert 'the host counts as one' in schema, 'Start RPC must clearly count the host'
print('v4 server-side player-count checks passed')
