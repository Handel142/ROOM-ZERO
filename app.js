import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_MODE } from "./config.js";

const $ = (s, root=document) => root.querySelector(s);
const app = $("#app"), modal = $("#modalBackdrop"), modalContent = $("#modalContent");
const state = { player: localStorage.getItem("rz_player") || "", room: null, supabase: null, channel: null, mode:"local", score:0, question:0, chat:[], members:[], currentGame:"brain" };
const questions = [
 {q:"Which number completes the pattern: 3, 6, 12, 24, ...?",a:["36","42","48","54"],correct:2,why:"Each number is doubled."},
 {q:"Which planet is known as the Red Planet?",a:["Venus","Mars","Jupiter","Mercury"],correct:1,why:"Mars appears reddish because of iron oxide on its surface."},
 {q:"What is the sum of the interior angles of a triangle?",a:["90°","180°","270°","360°"],correct:1,why:"A triangle's interior angles add up to 180 degrees."},
 {q:"Which is the largest ocean on Earth?",a:["Atlantic","Indian","Arctic","Pacific"],correct:3,why:"The Pacific Ocean is the largest."},
 {q:"What comes next: 1, 1, 2, 3, 5, 8, ...?",a:["11","12","13","15"],correct:2,why:"This is the Fibonacci sequence: add the previous two numbers."}
];
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message){const el=document.createElement("div");el.className="toast";el.textContent=message;$("#toastRegion").append(el);setTimeout(()=>el.remove(),3200)}
function showModal(html){modalContent.innerHTML=html;modal.classList.remove("hidden")}
function closeModal(){modal.classList.add("hidden")}
function playerName(){return state.player || "Guest"}
function makeCode(){return Math.random().toString(36).slice(2,8).toUpperCase().replace(/[01IO]/g,"Z").slice(0,6)}
function loadPlayer(){if(!state.player){state.player=localStorage.getItem("rz_player")||""} }
function setPlayer(name){state.player=name.trim().slice(0,18);localStorage.setItem("rz_player",state.player)}
function roomStore(){return JSON.parse(localStorage.getItem("rz_rooms")||"{}")}
function saveRooms(r){localStorage.setItem("rz_rooms",JSON.stringify(r))}
function localRoom(code){return roomStore()[code]}
function updateConnection(){const el=$("#connectionState");el.innerHTML=`<i></i><span>${state.mode==="supabase"?"Supabase connected":"Local preview"}</span>`}
async function initSupabase(){
 if(APP_MODE==="local" || !SUPABASE_URL || !SUPABASE_ANON_KEY){state.mode="local";updateConnection();return}
 try{
  const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  state.supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  const {data,error}=await state.supabase.auth.getSession(); if(error) throw error;
  if(!data.session){const sign=await state.supabase.auth.signInAnonymously();if(sign.error)throw sign.error}
  state.mode="supabase";updateConnection();
 }catch(e){console.error(e);state.mode="local";updateConnection();toast("Supabase could not connect. Local preview is active.")}
}
function createRoomUI(){showModal(`<p class="eyebrow">CREATE PRIVATE ARENA</p><h2>Set up your room</h2><p>Choose a name and room capacity. You can invite friends with a code or link.</p><div class="field"><label>YOUR DISPLAY NAME</label><input id="hostName" maxlength="18" placeholder="e.g. Alex" value="${escapeHTML(playerName()==="Guest"?"":playerName())}"></div><div class="field"><label>ROOM CAPACITY</label><select id="capacity"><option>8</option><option>12</option><option selected>20</option><option>30</option><option>50</option></select></div><div class="field"><label>FIRST GAME</label><select id="firstGame"><option value="brain">Brain Battle</option><option value="impostor">The Impostor</option><option value="mystery">The Mystery</option></select></div><button class="btn btn-primary" data-action="create-submit">Create private room</button>`)}
function joinUI(code=""){showModal(`<p class="eyebrow">PRIVATE INVITATION</p><h2>Join a room</h2><p>Enter the six-character invitation code shared by your host.</p><div class="field"><label>YOUR DISPLAY NAME</label><input id="joinName" maxlength="18" placeholder="Choose a display name" value="${escapeHTML(playerName()==="Guest"?"":playerName())}"></div><div class="field"><label>ROOM CODE</label><input id="joinCode" maxlength="6" placeholder="ABC123" value="${escapeHTML(code)}" style="text-transform:uppercase;letter-spacing:4px"></div><button class="btn btn-primary" data-action="join-submit">Join room</button>`)}
function createLocalRoom(name,capacity,game){
 const code=makeCode(),rooms=roomStore(),room={code,host:name,capacity:Number(capacity),game,created:Date.now(),members:[{name,host:true,score:0}],messages:[],status:"waiting"};
 rooms[code]=room;saveRooms(rooms);state.room=room;state.members=room.members;renderLobby();toast("Private room created.")
}
function joinLocalRoom(name,code){
 const rooms=roomStore(),room=rooms[code];
 if(!room){toast("Room not found in this browser. For cross-device play, connect Supabase.");return}
 if(room.status!=="waiting"){toast("This room is no longer accepting players.");return}
 if(room.members.some(m=>m.name.toLowerCase()===name.toLowerCase())){toast("That display name is already in this room.");return}
 if(room.members.length>=room.capacity){toast("This room is full.");return}
 room.members.push({name,host:false,score:0});rooms[code]=room;saveRooms(rooms);state.room=room;state.members=room.members;renderLobby();toast("You joined the room.")
}
function renderLobby(){
 const r=state.room;if(!r)return;
 showModal(`<p class="eyebrow">PRIVATE ROOM · ${r.status.toUpperCase()}</p><h2>Waiting lobby</h2><p>Share this code or invitation link with your friends.</p><div class="room-code">${r.code}</div><div class="hero-actions"><button class="btn btn-secondary" data-action="copy-code">Copy code</button><button class="btn btn-secondary" data-action="share-link">Share invitation link</button></div><div class="divider"></div><div style="display:flex;justify-content:space-between"><b>Players</b><span class="muted small">${r.members.length} / ${r.capacity}</span></div><div class="lobby-list">${r.members.map(m=>`<div class="player-row"><span>◉ ${escapeHTML(m.name)} ${m.host?"<small>HOST</small>":""}</span><small>${m.score} pts</small></div>`).join("")}</div><div class="divider"></div><b>Lobby chat</b><div class="chat-box" id="chatBox">${(r.messages||[]).map(m=>`<div class="chat-line"><b>${escapeHTML(m.name)}:</b> ${escapeHTML(m.text)}</div>`).join("") || '<span class="muted small">Say hello to the room.</span>'}</div><div class="chat-compose"><input id="chatInput" maxlength="180" placeholder="Write a message…"><button data-action="send-chat">Send</button></div><div class="reaction-row">${["😂","🔥","👏","😮","❤️","🤔"].map(e=>`<button data-action="react" data-emoji="${e}">${e}</button>`).join("")}</div><div class="divider"></div><div class="field"><label>GAME MODE</label><select id="lobbyGame"><option value="brain" ${r.game==="brain"?"selected":""}>Brain Battle</option><option value="impostor" ${r.game==="impostor"?"selected":""}>The Impostor</option><option value="mystery" ${r.game==="mystery"?"selected":""}>The Mystery</option></select></div><div class="field"><label>TEAM SETUP</label><select id="teamMode"><option value="auto">Automatic teams</option><option value="manual">Manual team selection (preview)</option><option value="none">No teams</option></select></div><button class="btn btn-primary" data-action="start-game">${r.members[0].name===playerName()?"Start game":"Ready — waiting for host"}</button><button class="btn btn-secondary" data-action="leave-room">Leave room</button>`);
}
function gameInfo(game){const info={brain:["Brain Battle","Challenge your reasoning with patterns, general knowledge and quick thinking."],impostor:["The Impostor","Everyone receives a secret role. Share clues and use deduction to identify the impostor."],mystery:["The Mystery","Work together to examine clues, compare theories and solve a fictional case."]}[game];showModal(`<p class="eyebrow">GAME INTELLIGENCE</p><h2>${info[0]}</h2><p>${info[1]}</p><p class="muted small">This game is available in the current project foundation. Some multiplayer-specific mechanics are being completed in the next development stage.</p><button class="btn btn-primary" data-action="create-room">Create a room to play</button>`)}
function startBrain(){
 state.currentGame="brain";state.question=0;state.score=0;renderQuestion();
}
function renderQuestion(){
 const q=questions[state.question%questions.length];
 showModal(`<p class="eyebrow">BRAIN BATTLE · QUESTION ${state.question+1}</p><div style="display:flex;justify-content:space-between"><span class="status">LIVE CHALLENGE</span><span class="muted small">Score: ${state.score}</span></div><div class="question-card"><h3>${q.q}</h3>${q.a.map((a,i)=>`<button class="answer-option" data-action="answer" data-index="${i}">${String.fromCharCode(65+i)}. ${a}</button>`).join("")}</div><p class="muted small">Choose your answer. Your result is shown immediately in this local preview.</p><button class="btn btn-secondary" data-action="exit-game">Exit game</button>`);
}
function answer(index){
 const q=questions[state.question%questions.length],correct=index===q.correct;
 if(correct)state.score+=10;
 showModal(`<p class="eyebrow">BRAIN BATTLE · RESULT</p><h2>${correct?"Correct. Well reasoned.":"Not quite."}</h2><div class="result"><b>${correct?"+10 points":"0 points"}</b><p>${q.why}</p></div><p class="muted small">Current score: ${state.score}</p><button class="btn btn-primary" data-action="next-question">Next question</button>`);
}
function startOtherGame(game){
 state.currentGame=game;
 if(game==="impostor"){showModal(`<p class="eyebrow">THE IMPOSTOR</p><h2>Secret role setup</h2><p>This mode needs multiple connected players to securely distribute secret roles. The current preview shows the rules, but does not assign online secret roles yet.</p><div class="result"><b>How it will work</b><p>Most players receive the same secret word. One player receives the impostor role. Players give clues and vote.</p></div><button class="btn btn-primary" data-action="back-lobby">Back to lobby</button>`)}
 else{showModal(`<p class="eyebrow">THE MYSTERY</p><h2>The missing archive</h2><p>A fictional case awaits. The full cooperative evidence and clue system is part of the next game-engine milestone.</p><div class="result"><b>Case briefing</b><p>An archive has gone missing from a locked study. Examine the timeline, compare witness statements and identify the inconsistency.</p></div><button class="btn btn-primary" data-action="back-lobby">Back to lobby</button>`)}
}
function sendChat(text){if(!state.room||!text.trim())return;const rooms=roomStore(),r=rooms[state.room.code];if(!r)return;r.messages=r.messages||[];r.messages.push({name:playerName(),text:text.trim().slice(0,180)});r.messages=r.messages.slice(-40);rooms[r.code]=r;saveRooms(rooms);state.room=r;renderLobby()}
async function shareRoom(){
 const url=new URL(location.href);url.searchParams.set("room",state.room.code);
 try{if(navigator.share){await navigator.share({title:"Join my ROOM ZERO game",text:`Join my private room: ${state.room.code}`,url:url.toString()})}else{await navigator.clipboard.writeText(url.toString());toast("Invitation link copied.")}}catch(e){toast("Sharing was cancelled or unavailable.")}
}
function routeAction(action,el){
 if(action==="create-room")createRoomUI();
 else if(action==="join-prompt")joinUI();
 else if(action==="create-submit"){
  const name=$("#hostName").value.trim()||"Guest";setPlayer(name);createLocalRoom(name,$("#capacity").value,$("#firstGame").value);
 }else if(action==="join-submit"){
  const name=$("#joinName").value.trim()||"Guest",code=$("#joinCode").value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code)){toast("Enter a valid six-character code.");return}setPlayer(name);joinLocalRoom(name,code);
 }else if(action==="close-modal")closeModal();
 else if(action==="copy-code"){navigator.clipboard?.writeText(state.room.code).then(()=>toast("Room code copied.")).catch(()=>toast("Your room code is "+state.room.code))}
 else if(action==="share-link")shareRoom();
 else if(action==="send-chat"){sendChat($("#chatInput").value)}
 else if(action==="react"){sendChat(el.dataset.emoji)}
 else if(action==="start-game"){if(state.room.members[0].name!==playerName()){toast("Only the host can start this room.");return}const r=roomStore()[state.room.code];r.game=$("#lobbyGame").value;r.status="playing";saveRooms({...roomStore(),[r.code]:r});state.room=r;if(r.game==="brain")startBrain();else startOtherGame(r.game)}
 else if(action==="answer")answer(Number(el.dataset.index));
 else if(action==="next-question"){state.question++;renderQuestion()}
 else if(action==="exit-game"){closeModal();if(state.room)renderLobby()}
 else if(action==="back-lobby")renderLobby();
 else if(action==="leave-room"){state.room=null;closeModal();toast("You left the room.")}
 else if(action==="game-info")gameInfo(el.dataset.game);
 else if(action==="about")showModal(`<p class="eyebrow">PROJECT INFORMATION</p><h2>ROOM ZERO · Foundation build</h2><p>This ZIP contains the responsive PWA shell, local preview room flow, basic Brain Battle sample, theme switching, and Supabase database starter. Local preview data is stored in this browser and is not shared across devices.</p><p>Connect a Supabase project and apply the included SQL before enabling online multiplayer.</p><button class="btn btn-primary" data-action="close-modal">Understood</button>`);
 else if(action==="home"){closeModal();state.room=null}
}
document.addEventListener("click",e=>{const el=e.target.closest("[data-action]");if(el){e.preventDefault();routeAction(el.dataset.action,el)}});
$("#themeToggle").addEventListener("click",()=>{const next=document.documentElement.dataset.theme==="light"?"dark":"light";document.documentElement.dataset.theme=next;localStorage.setItem("rz_theme",next);$("#themeToggle").textContent=next==="light"?"☾":"☼"});
$("#profileButton").addEventListener("click",()=>{showModal(`<p class="eyebrow">PLAYER IDENTITY</p><h2>Your player name</h2><div class="field"><label>DISPLAY NAME</label><input id="profileName" maxlength="18" value="${escapeHTML(playerName()==="Guest"?"":playerName())}" placeholder="Choose a name"></div><button class="btn btn-primary" data-action="save-profile">Save name</button>`);});
document.addEventListener("click",e=>{const el=e.target.closest('[data-action="save-profile"]');if(el){const n=$("#profileName").value.trim();if(n)setPlayer(n);closeModal();toast("Player name saved.")}});
$("#modalBackdrop").addEventListener("click",e=>{if(e.target===$("#modalBackdrop"))closeModal()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();if(e.key==="Enter"&&e.target.id==="chatInput")sendChat(e.target.value)});
document.documentElement.dataset.theme=localStorage.getItem("rz_theme")||"dark";$("#themeToggle").textContent=document.documentElement.dataset.theme==="light"?"☾":"☼";
$("#year").textContent=new Date().getFullYear();loadPlayer();initSupabase();
const invite=new URLSearchParams(location.search).get("room");if(invite)setTimeout(()=>joinUI(invite),300);
if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
