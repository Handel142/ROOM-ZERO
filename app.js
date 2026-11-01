(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = {
    player: localStorage.getItem('rz_player') || '',
    room: null,
    score: 0,
    question: 0,
    answered: false,
    theme: localStorage.getItem('rz_theme') || 'dark'
  };
  const questions = [
    { q: 'Which number completes the pattern: 3, 6, 12, 24, …?', a: ['36', '42', '48', '54'], correct: 2, why: 'Each number is doubled.' },
    { q: 'Which planet is known as the Red Planet?', a: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1, why: 'Mars appears reddish because of iron oxide on its surface.' },
    { q: 'What is the sum of the interior angles of a triangle?', a: ['90°', '180°', '270°', '360°'], correct: 1, why: 'The interior angles of a triangle add up to 180 degrees.' },
    { q: 'Which is the largest ocean on Earth?', a: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3, why: 'The Pacific Ocean is the largest.' },
    { q: 'What comes next: 1, 1, 2, 3, 5, 8, …?', a: ['11', '12', '13', '15'], correct: 2, why: 'Add the previous two numbers to get the next number.' },
    { q: 'How many sides does a hexagon have?', a: ['5', '6', '7', '8'], correct: 1, why: 'A hexagon has six sides.' },
    { q: 'Which gas do plants absorb from the atmosphere?', a: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correct: 2, why: 'Plants use carbon dioxide during photosynthesis.' }
  ];
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const roomStore = () => { try { return JSON.parse(localStorage.getItem('rz_rooms') || '{}'); } catch { return {}; } };
  const saveRooms = rooms => localStorage.setItem('rz_rooms', JSON.stringify(rooms));
  const playerName = () => state.player || 'Guest';
  const config = window.ROOM_ZERO_CONFIG || {};
  let supabase = null;
  const onlineEnabled = () => config.mode === 'supabase' && !!config.supabaseUrl && !!config.supabaseAnonKey && !!window.supabase;
  async function getOnlineClient() {
    if (!onlineEnabled()) throw new Error('Online rooms are not configured yet. Add your Supabase URL and anon key in js/config.js, then deploy again.');
    if (!supabase) {
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) { const result = await supabase.auth.signInAnonymously(); if (result.error) throw result.error; }
    }
    return supabase;
  }
  async function fetchOnlineRoom(code) {
    const db = await getOnlineClient();
    const { data: roomRow, error } = await db.from('rooms').select('*').eq('code', code).single();
    if (error) throw new Error('Room not found. Check the code and make sure the host has created it online.');
    const [{ data: members, error: memberError }, { data: messages, error: messageError }] = await Promise.all([
      db.from('room_members').select('*').eq('room_id', roomRow.id).order('joined_at'),
      db.from('room_messages').select('*').eq('room_id', roomRow.id).order('created_at').limit(40)
    ]);
    if (memberError) throw memberError; if (messageError) throw messageError;
    return { id: roomRow.id, code: roomRow.code, host: members.find(m => m.is_host)?.display_name || 'Host', capacity: roomRow.capacity, game: roomRow.game_mode, created: Date.parse(roomRow.created_at), status: roomRow.status, members: members.map(m => ({ id: m.user_id, name: m.display_name, host: m.is_host, score: m.score })), messages: messages.map(m => ({ name: m.display_name, text: m.body })) };
  }

  const setPlayer = name => { state.player = name.trim().slice(0, 18) || 'Guest'; localStorage.setItem('rz_player', state.player); updateAvatar(); };
  const updateAvatar = () => { const button = $('#profileButton'); if (button) button.textContent = playerName().slice(0,1).toUpperCase(); };
  function toast(message, kind = '') {
    const region = $('#toastRegion'); if (!region) return;
    const item = document.createElement('div'); item.className = `toast ${kind}`; item.textContent = message; region.append(item);
    window.setTimeout(() => item.remove(), 3200);
  }
  function showModal(markup) {
    const backdrop = $('#modalBackdrop'); $('#modalContent').innerHTML = markup; backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open');
    const first = $('input, select, button', backdrop); if (first) window.setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    const backdrop = $('#modalBackdrop'); backdrop.classList.add('hidden'); backdrop.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open');
  }
  function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = '';
    do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (roomStore()[code]);
    return code;
  }
  function createRoomUI() {
    showModal(`<p class="eyebrow">CREATE PRIVATE ARENA</p><h2 id="modalTitle">Set up your room</h2><p>Choose a display name, room size and the first challenge.</p>
      <div class="field"><label for="hostName">YOUR DISPLAY NAME</label><input id="hostName" maxlength="18" autocomplete="nickname" placeholder="Choose a name" value="${escapeHTML(state.player)}"></div>
      <div class="field"><label for="capacity">ROOM CAPACITY</label><select id="capacity"><option value="4">4 players</option><option value="8">8 players</option><option value="12">12 players</option><option value="20" selected>20 players</option><option value="30">30 players</option></select></div>
      <div class="field"><label for="firstGame">FIRST GAME</label><select id="firstGame"><option value="brain">Brain Battle</option><option value="impostor">The Impostor</option><option value="mystery">The Mystery</option></select></div>
      <button class="btn btn-primary" data-action="create-submit">Create private room</button>`);
  }
  function joinUI(code = '') {
    showModal(`<p class="eyebrow">PRIVATE INVITATION</p><h2 id="modalTitle">Join a room</h2><p>Enter the six-character code from your host.</p>
      <div class="field"><label for="joinName">YOUR DISPLAY NAME</label><input id="joinName" maxlength="18" autocomplete="nickname" placeholder="Choose a name" value="${escapeHTML(state.player)}"></div>
      <div class="field"><label for="joinCode">ROOM CODE</label><input id="joinCode" maxlength="6" autocapitalize="characters" placeholder="ABC234" value="${escapeHTML(code)}" class="code-input"></div>
      <button class="btn btn-primary" data-action="join-submit">Join room</button>`);
  }
  async function createRoom(name, capacity, game) {
    try {
      if (config.mode === 'supabase') {
        const db = await getOnlineClient();
        const { data, error } = await db.rpc('create_room', { p_display_name: name, p_capacity: Number(capacity), p_game_mode: game });
        if (error) throw error;
        const code = Array.isArray(data) ? data[0].room_code : data.room_code;
        state.room = await fetchOnlineRoom(code); state.online = true; renderLobby(); toast('Your online room is ready.'); return;
      }
      const code = makeCode();
      const room = { code, host: name, capacity: Number(capacity), game, created: Date.now(), members: [{ id: 'host', name, host: true, score: 0 }], messages: [], status: 'waiting' };
      const rooms = roomStore(); rooms[code] = room; saveRooms(rooms); state.room = room; state.online = false; renderLobby(); toast('Your local preview room is ready.');
    } catch (error) { console.error(error); toast(error.message || 'Could not create room. Check your Supabase setup.', 'error'); }
  }
  async function joinRoom(name, code) {
    try {
      if (config.mode === 'supabase') {
        const db = await getOnlineClient();
        const { error } = await db.rpc('join_room', { p_code: code, p_display_name: name });
        if (error) throw error;
        state.room = await fetchOnlineRoom(code); state.online = true; renderLobby(); toast('You joined the online room.'); return;
      }
      const rooms = roomStore(), room = rooms[code];
      if (!room) { toast('Room not found in this browser. This project is in local preview mode; configure Supabase for cross-device rooms.'); return; }
      if (room.status !== 'waiting') { toast('This room has already started.'); return; }
      if (room.members.some(member => member.name.toLowerCase() === name.toLowerCase())) { toast('That name is already being used in this room.'); return; }
      if (room.members.length >= room.capacity) { toast('This room is full.'); return; }
      room.members.push({ id: `guest-${Date.now()}`, name, host: false, score: 0 }); rooms[code] = room; saveRooms(rooms); state.room = room; state.online = false; renderLobby(); toast('You joined the room.');
    } catch (error) { console.error(error); toast(error.message || 'Could not join room.', 'error'); }
  }
  function renderLobby() {
    const room = state.room; if (!room) return;
    const isHost = room.members[0] && room.members[0].name === playerName();
    showModal(`<p class="eyebrow">PRIVATE ROOM · ${room.status.toUpperCase()}</p><h2 id="modalTitle">Waiting lobby</h2><p>Share the invitation with your group. ${state.online ? 'This room is stored online and can be joined from other devices.' : 'Local preview: rooms are saved only in this browser.'}</p>
      <div class="room-code" aria-label="Room code">${room.code}</div>
      <div class="hero-actions room-actions"><button class="btn btn-secondary" data-action="copy-code">Copy code</button><button class="btn btn-secondary" data-action="share-link">Share invitation</button></div>
      <div class="divider"></div><div class="split-line"><b>Players</b><span class="muted small">${room.members.length} / ${room.capacity}</span></div>
      <div class="lobby-list">${room.members.map(member => `<div class="player-row"><span>◉ ${escapeHTML(member.name)} ${member.host ? '<small>HOST</small>' : ''}</span><small>${member.score} pts</small></div>`).join('')}</div>
      <div class="divider"></div><b>Room chat</b><div class="chat-box" id="chatBox">${room.messages.length ? room.messages.map(message => `<div class="chat-line"><b>${escapeHTML(message.name)}:</b> ${escapeHTML(message.text)}</div>`).join('') : '<span class="muted small">Start the conversation.</span>'}</div>
      <div class="chat-compose"><input id="chatInput" maxlength="180" placeholder="Write a message…" aria-label="Chat message"><button data-action="send-chat">Send</button></div>
      <div class="reaction-row">${['😂','🔥','👏','😮','❤️','🤔'].map(emoji => `<button data-action="react" data-emoji="${emoji}" aria-label="React ${emoji}">${emoji}</button>`).join('')}</div>
      ${isHost ? `<div class="divider"></div><div class="field"><label for="lobbyGame">GAME MODE</label><select id="lobbyGame"><option value="brain" ${room.game === 'brain' ? 'selected' : ''}>Brain Battle</option><option value="impostor" ${room.game === 'impostor' ? 'selected' : ''}>The Impostor</option><option value="mystery" ${room.game === 'mystery' ? 'selected' : ''}>The Mystery</option></select></div><button class="btn btn-primary" data-action="start-game">Start game</button>` : '<p class="muted small">The host will start the game when everyone is ready.</p>'}
      <button class="btn btn-secondary full-button" data-action="leave-room">Leave room</button>`);
  }
  function gameInfo(game) {
    const data = {
      brain: ['Brain Battle', 'A series of logic, memory, mathematics and general-knowledge questions. Earn points for correct answers.'],
      impostor: ['The Impostor', 'Players receive secret information, share clues and vote to identify the player who does not know the word.'],
      mystery: ['The Mystery', 'Explore a fictional case, inspect evidence and work together to identify what happened.']
    }[game];
    if (!data) return;
    showModal(`<p class="eyebrow">GAME INTELLIGENCE</p><h2 id="modalTitle">${data[0]}</h2><p>${data[1]}</p><div class="result"><b>Preview status</b><p>${game === 'brain' ? 'Brain Battle has a playable sample round.' : 'This mode is presented as a preview; its complete multiplayer rules are not active yet.'}</p></div><button class="btn btn-primary" data-action="create-room">Create a room</button>`);
  }
  function startBrain() { state.question = 0; state.score = 0; state.answered = false; renderQuestion(); }
  function renderQuestion() {
    const question = questions[state.question % questions.length]; state.answered = false;
    showModal(`<p class="eyebrow">BRAIN BATTLE · QUESTION ${state.question + 1} / ${questions.length}</p><div class="split-line"><span class="status">PRACTICE ROUND</span><span class="muted small">Score: ${state.score}</span></div>
      <div class="question-card"><h3>${question.q}</h3>${question.a.map((answer, index) => `<button class="answer-option" data-action="answer" data-index="${index}">${String.fromCharCode(65 + index)}. ${answer}</button>`).join('')}</div>
      <p class="muted small">Choose one answer. This is a local practice round, not a live multiplayer match.</p><button class="btn btn-secondary full-button" data-action="exit-game">Return to lobby</button>`);
  }
  function answer(index) {
    if (state.answered) return; state.answered = true;
    const question = questions[state.question % questions.length], correct = index === question.correct; if (correct) state.score += 10;
    showModal(`<p class="eyebrow">BRAIN BATTLE · RESULT</p><h2 id="modalTitle">${correct ? 'Correct. Well reasoned.' : 'Not quite.'}</h2><div class="result"><b>${correct ? '+10 points' : '0 points'}</b><p>${question.why}</p></div><p class="muted small">Your practice score: ${state.score}</p><button class="btn btn-primary" data-action="next-question">${state.question + 1 >= questions.length ? 'Play again' : 'Next question'}</button><button class="btn btn-secondary full-button" data-action="exit-game">Return to lobby</button>`);
  }
  function startOtherGame(game) {
    const impostor = game === 'impostor';
    showModal(`<p class="eyebrow">${impostor ? 'THE IMPOSTOR' : 'THE MYSTERY'}</p><h2 id="modalTitle">${impostor ? 'The secret is not revealed yet' : 'The missing archive'}</h2><p>${impostor ? 'This screen explains the intended game. Secure private role assignment and voting will be added with the online game engine.' : 'A fictional archive has gone missing from a locked study. The full evidence board and group decision system are part of the next development stage.'}</p><div class="result"><b>Game preview</b><p>${impostor ? 'Most players will receive one shared word. One player will be the impostor. Everyone gives clues before voting.' : 'Players will inspect witness statements, compare the timeline and agree on a solution.'}</p></div><button class="btn btn-primary" data-action="back-lobby">Back to lobby</button>`);
  }
  async function sendChat(message) {
    if (!state.room || !message.trim()) return;
    try {
      if (state.online) {
        const db = await getOnlineClient(); const { data: session } = await db.auth.getSession();
        const member = state.room.members.find(m => m.name === playerName());
        const { error } = await db.from('room_messages').insert({ room_id: state.room.id, user_id: session.session.user.id, display_name: playerName(), body: message.trim().slice(0, 180) });
        if (error) throw error; state.room = await fetchOnlineRoom(state.room.code); renderLobby(); return;
      }
      const rooms = roomStore(), room = rooms[state.room.code]; if (!room) return;
      room.messages = room.messages || []; room.messages.push({ name: playerName(), text: message.trim().slice(0, 180) }); room.messages = room.messages.slice(-40);
      rooms[room.code] = room; saveRooms(rooms); state.room = room; renderLobby();
    } catch (error) { console.error(error); toast(error.message || 'Message could not be sent.', 'error'); }
  }
  async function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text); else { const field = document.createElement('textarea'); field.value = text; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select(); const ok = document.execCommand('copy'); field.remove(); if (!ok) throw new Error('Copy unavailable'); } toast('Copied to clipboard.'); }
    catch { toast(`Copy this: ${text}`); }
  }
  async function shareRoom() {
    if (!state.room) return;
    const url = new URL(location.href); url.searchParams.set('room', state.room.code);
    try { if (navigator.share) await navigator.share({ title: 'Join my ROOM ZERO room', text: `Room code: ${state.room.code}`, url: url.href }); else await copyText(url.href); }
    catch (error) { if (error.name !== 'AbortError') toast('Sharing is not available on this device.'); }
  }
  function handleAction(action, element) {
    switch (action) {
      case 'create-room': createRoomUI(); break;
      case 'join-prompt': joinUI(); break;
      case 'create-submit': {
        const name = $('#hostName').value.trim() || 'Guest'; setPlayer(name); createRoom(name, $('#capacity').value, $('#firstGame').value); break;
      }
      case 'join-submit': {
        const name = $('#joinName').value.trim() || 'Guest', code = $('#joinCode').value.trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { toast('Enter a valid six-character room code.'); return; }
        setPlayer(name); joinRoom(name, code); break;
      }
      case 'close-modal': closeModal(); break;
      case 'copy-code': if (state.room) copyText(state.room.code); break;
      case 'share-link': shareRoom(); break;
      case 'send-chat': sendChat($('#chatInput').value); break;
      case 'react': sendChat(element.dataset.emoji); break;
      case 'start-game': {
        if (!state.room) return; if (state.online) { toast('Online game start needs the host-control RPC; the online lobby and chat are enabled.'); return; } const rooms = roomStore(), room = rooms[state.room.code]; if (!room) { toast('Room could not be found.'); return; }
        room.game = $('#lobbyGame').value; room.status = 'playing'; rooms[room.code] = room; saveRooms(rooms); state.room = room;
        if (room.game === 'brain') startBrain(); else startOtherGame(room.game); break;
      }
      case 'answer': answer(Number(element.dataset.index)); break;
      case 'next-question': state.question = (state.question + 1) % questions.length; renderQuestion(); break;
      case 'exit-game': if (state.room) renderLobby(); else closeModal(); break;
      case 'back-lobby': renderLobby(); break;
      case 'leave-room': state.room = null; closeModal(); toast('You left the room.'); break;
      case 'game-info': gameInfo(element.dataset.game); break;
      case 'game-preview': showModal(`<p class="eyebrow">COMING IN A FUTURE UPDATE</p><h2 id="modalTitle">${element.dataset.game === 'connection' ? 'Mind Connection' : element.dataset.game === 'speed' ? 'The 60-Second Test' : 'The Master Plan'}</h2><p>This game is part of the ROOM ZERO roadmap. Its button is active so you can view its status; gameplay will be added after the core room experience is stable.</p><button class="btn btn-primary" data-action="close-modal">Back to arena</button>`); break;
      case 'about': showModal(`<p class="eyebrow">ABOUT THIS BUILD</p><h2 id="modalTitle">ROOM ZERO · Foundation</h2><p>This build focuses on a stable, responsive interface and working local interactions. Room data stays in this browser. Cross-device multiplayer is not enabled yet.</p><button class="btn btn-primary" data-action="close-modal">Understood</button>`); break;
      case 'home': state.room = null; closeModal(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'save-profile': { const name = $('#profileName').value.trim(); if (!name) { toast('Enter a display name first.'); return; } setPlayer(name); closeModal(); toast('Player name saved.'); break; }
      default: console.warn('Unmapped ROOM ZERO action:', action);
    }
  }
  function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.theme;
    localStorage.setItem('rz_theme', state.theme); const toggle = $('#themeToggle');
    toggle.textContent = state.theme === 'light' ? '☾' : '☼'; toggle.setAttribute('aria-label', state.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }
  function bindEvents() {
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-action]'); if (!target) return;
      event.preventDefault();
      try { handleAction(target.dataset.action, target); } catch (error) { console.error('ROOM ZERO action failed:', error); toast('That action could not be completed. Please try again.', 'error'); }
    });
    $('#themeToggle').addEventListener('click', () => applyTheme(state.theme === 'light' ? 'dark' : 'light'));
    $('#profileButton').addEventListener('click', () => showModal(`<p class="eyebrow">PLAYER IDENTITY</p><h2 id="modalTitle">Your player name</h2><div class="field"><label for="profileName">DISPLAY NAME</label><input id="profileName" maxlength="18" value="${escapeHTML(state.player)}" placeholder="Choose a name"></div><button class="btn btn-primary" data-action="save-profile">Save name</button>`));
    $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); if (event.key === 'Enter' && event.target.id === 'chatInput') { event.preventDefault(); sendChat(event.target.value); } });
  }
  function init() {
    applyTheme(state.theme); updateAvatar(); $('#year').textContent = new Date().getFullYear(); bindEvents();
    const connection = $('#connectionState'); connection.innerHTML = '<i></i><span>' + (config.mode === 'supabase' ? 'Online mode' : 'Local preview') + '</span>'; connection.title = config.mode === 'supabase' ? 'Supabase online rooms configured' : 'Local preview — configure Supabase for cross-device rooms';
    const invite = new URLSearchParams(location.search).get('room'); if (invite) window.setTimeout(() => joinUI(invite.toUpperCase()), 250);
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker registration skipped:', error));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
