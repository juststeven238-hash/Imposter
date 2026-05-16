import { useState, useEffect, useRef, useCallback } from "react";
import { readGame, writeGame, updateGame, subscribeGame } from "./firebase";
import { CATEGORIES, randomWord } from "./words";

// ─── utils ────────────────────────────────────────────────────────────────────
const randCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();
const LS_KEY = "imposter_session";
const saveSession = d => { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} };
const loadSession = () => { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const clearSession = () => { try { localStorage.removeItem(LS_KEY); } catch {} };

// ─── Spotify ──────────────────────────────────────────────────────────────────
// Uses Spotify Web Playback SDK + Authorization Code flow
// Client ID should be set in env or hardcoded for demo
const SPOTIFY_CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID"; // <-- vervang met jouw Spotify Client ID
const SPOTIFY_REDIRECT = window.location.origin + "/callback";
const SPOTIFY_SCOPES = "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state";

function getSpotifyAuthUrl() {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "token",
    redirect_uri: SPOTIFY_REDIRECT,
    scope: SPOTIFY_SCOPES,
    show_dialog: "true",
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

function getSpotifyToken() {
  // Check URL hash for token (after redirect)
  const hash = window.location.hash;
  if (hash) {
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get("access_token");
    if (token) {
      localStorage.setItem("spotify_token", token);
      window.history.replaceState(null, null, window.location.pathname);
      return token;
    }
  }
  return localStorage.getItem("spotify_token");
}

async function searchSpotify(query, token) {
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=6`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) { localStorage.removeItem("spotify_token"); return []; }
  const data = await res.json();
  return data.tracks?.items || [];
}

async function playTrack(trackUri, token, deviceId) {
  await fetch(`https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ""}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [trackUri], position_ms: 30000 }) // start at 30s for excitement
  });
}

async function pauseTrack(token) {
  await fetch("https://api.spotify.com/v1/me/player/pause", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0a0f", card: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.09)",
  borderPurple: "rgba(168,85,247,.35)", borderGreen: "rgba(34,197,94,.35)",
  borderRed: "rgba(239,68,68,.35)", borderSpotify: "rgba(30,215,96,.35)",
  purple: "#a855f7", purpleLight: "#c084fc",
  green: "#22c55e", red: "#ef4444", gold: "#f59e0b",
  spotify: "#1ed760", text: "#e8e6f0", muted: "#6b6880", faint: "#14141f",
};

export default function App() {
  const [name, setName]       = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [game, setGame]       = useState(null);
  const [myId]                = useState(() => loadSession()?.myId || Math.random().toString(36).slice(2));
  const [isHost, setIsHost]   = useState(false);
  const [err, setErr]         = useState("");
  const [screen, setScreen]   = useState("home"); // home | lobby | reveal | game | vote | result
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab]         = useState("spelers");

  // Host – woord modus
  const [gameMode, setGameMode]     = useState("word"); // "word" | "music"
  const [customWord, setCustomWord] = useState("");
  const [selectedCat, setSelectedCat] = useState("dieren");
  const [hintTimer, setHintTimer]   = useState(30);
  const [showWordToHost, setShowWordToHost] = useState(false);

  // Reveal flow (per speler hun woord zien)
  const [revealIdx, setRevealIdx]   = useState(0);
  const [revealShowing, setRevealShowing] = useState(false);

  // Hints
  const [myHint, setMyHint]         = useState("");
  const [hintIngediend, setHintIngediend] = useState(false);

  // Stemmen
  const [myStem, setMyStem]         = useState(null);
  const [stemIngediend, setStemIngediend] = useState(false);

  // Imposter raadt
  const [imposterRaad, setImposterRaad] = useState("");
  const [imposterGeraden, setImposterGeraden] = useState(false);

  // Spotify
  const [spotifyToken, setSpotifyToken] = useState(() => getSpotifyToken());
  const [spotifySearch, setSpotifySearch] = useState("");
  const [spotifyResults, setSpotifyResults] = useState([]);
  const [spotifySearching, setSpotifySearching] = useState(false);
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);
  const [spotifyDeviceId, setSpotifyDeviceId] = useState(null);
  const spotifyPlayerRef = useRef(null);

  const unsubRef  = useRef(null);
  const codeRef   = useRef(null);
  const prevRef   = useRef(null);
  const timerRef  = useRef(null);

  // ─── Subscribe ───────────────────────────────────────────────────────────
  const subscribe = useCallback((code) => {
    if (unsubRef.current) unsubRef.current();
    codeRef.current = code;
    unsubRef.current = subscribeGame(code, g => {
      if (g) { setGame(prev => { prevRef.current = prev; return g; }); }
    });
  }, []);

  // ─── Watch game status changes ────────────────────────────────────────────
  useEffect(() => {
    if (!game) return;
    const prev = prevRef.current;
    if (game.status === "revealing" && prev?.status === "lobby") {
      setRevealIdx(0); setRevealShowing(false); setScreen("reveal");
    }
    if (game.status === "hinting" && prev?.status !== "hinting") {
      setMyHint(""); setHintIngediend(false); setScreen("game");
    }
    if (game.status === "voting" && prev?.status !== "voting") {
      setMyStem(null); setStemIngediend(false); setScreen("vote");
    }
    if (game.status === "result" && prev?.status !== "result") {
      setScreen("result");
    }
    if (game.status === "lobby" && prev?.status === "result") {
      setScreen("lobby"); resetRound();
    }
  }, [game]);

  // ─── Spotify Web Playback SDK ─────────────────────────────────────────────
  useEffect(() => {
    if (!spotifyToken || !isHost) return;
    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: "Imposter App",
        getOAuthToken: cb => cb(spotifyToken),
        volume: 0.8,
      });
      player.addListener("ready", ({ device_id }) => setSpotifyDeviceId(device_id));
      player.addListener("not_ready", () => setSpotifyDeviceId(null));
      player.connect();
      spotifyPlayerRef.current = player;
    };
    if (!document.getElementById("spotify-sdk")) {
      const s = document.createElement("script");
      s.id = "spotify-sdk";
      s.src = "https://sdk.scdn.co/spotify-player.js";
      document.body.appendChild(s);
    }
    return () => { spotifyPlayerRef.current?.disconnect(); };
  }, [spotifyToken, isHost]);

  // ─── Restore session ──────────────────────────────────────────────────────
  useEffect(() => {
    async function restore() {
      const s = loadSession();
      if (!s) { setRestoring(false); return; }
      const g = await readGame(s.code);
      if (!g || (!s.isHost && !g.members?.[s.myId])) { clearSession(); setRestoring(false); return; }
      setName(s.name); setIsHost(s.isHost); setGame(g);
      subscribe(s.code);
      setScreen(g.status === "lobby" ? "lobby" : g.status === "hinting" ? "game" : g.status === "voting" ? "vote" : g.status === "result" ? "result" : "lobby");
      setRestoring(false);
    }
    restore();
  }, []); // eslint-disable-line

  useEffect(() => () => {
    if (unsubRef.current) unsubRef.current();
    clearInterval(timerRef.current);
  }, []);

  // ─── Actions: create / join ───────────────────────────────────────────────
  async function createGame() {
    if (!name.trim()) return setErr("Voer een naam in");
    const code = randCode();
    const g = {
      code, status: "lobby", mode: "word",
      host: myId, hostName: name.trim(),
      members: {}, word: null, track: null,
      hints: {}, votes: {}, scores: {},
      ronde: 1, imposterRaadResultaat: null,
      createdAt: Date.now(),
    };
    await writeGame(code, g);
    setGame(g); setIsHost(true); setErr("");
    saveSession({ code, myId, name: name.trim(), isHost: true });
    subscribe(code); setScreen("lobby");
  }

  async function joinGame() {
    if (!name.trim()) return setErr("Voer een naam in");
    const code = joinCode.trim().toUpperCase();
    if (!code) return setErr("Voer een code in");
    const g = await readGame(code);
    if (!g) return setErr("Party niet gevonden");
    if (g.status !== "lobby") return setErr("Spel is al begonnen");
    const updated = { ...g, members: { ...g.members, [myId]: { name: name.trim(), score: 0 } } };
    await writeGame(code, updated);
    setGame(updated); setIsHost(false); setErr("");
    saveSession({ code, myId, name: name.trim(), isHost: false });
    subscribe(code); setScreen("lobby");
  }

  // ─── Start round ─────────────────────────────────────────────────────────
  async function startRound() {
    const g = await readGame(codeRef.current);
    const memberIds = Object.keys(g.members || {});
    if (memberIds.length < 2) return setErr("Minimaal 2 spelers nodig!");

    // Pick random imposter (not host)
    const imposterId = memberIds[Math.floor(Math.random() * memberIds.length)];

    // Pick word
    const word = customWord.trim() || randomWord(selectedCat);

    let track = null;
    if (gameMode === "music" && g.track) track = g.track;

    // Assign roles
    const members = { ...g.members };
    memberIds.forEach(id => {
      members[id] = { ...members[id], isImposter: id === imposterId };
    });

    await updateGame(codeRef.current, {
      status: "revealing",
      mode: gameMode,
      word,
      track,
      imposter: imposterId,
      members,
      hints: {},
      votes: {},
      imposterRaadResultaat: null,
    });
    setErr("");
  }

  // ─── Reveal flow ──────────────────────────────────────────────────────────
  // Each player taps "ik heb gezien" then passes phone — host manages
  function nextReveal() {
    const memberList = game?.members ? Object.values(game.members) : [];
    if (revealIdx < memberList.length - 1) {
      setRevealIdx(i => i + 1);
      setRevealShowing(false);
    } else {
      // All seen — move to hinting
      updateGame(codeRef.current, { status: "hinting" });
    }
  }

  // ─── Hints ────────────────────────────────────────────────────────────────
  async function submitHint() {
    if (!myHint.trim()) return;
    await updateGame(codeRef.current, { [`hints/${myId}`]: { name: myMember?.name || "?", hint: myHint.trim() } });
    setHintIngediend(true);
  }

  async function moveToVoting() {
    await updateGame(codeRef.current, { status: "voting" });
  }

  // ─── Voting ───────────────────────────────────────────────────────────────
  async function submitVote(targetId) {
    if (stemIngediend) return;
    await updateGame(codeRef.current, { [`votes/${myId}`]: targetId });
    setMyStem(targetId); setStemIngediend(true);
  }

  async function processVotes() {
    const g = await readGame(codeRef.current);
    const votes = g.votes || {};
    const count = {};
    Object.values(votes).forEach(v => { count[v] = (count[v] || 0) + 1; });
    const topId = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
    const isCorrect = topId === g.imposter;
    // Scores
    const members = { ...g.members };
    const memberIds = Object.keys(members);
    if (isCorrect) {
      // Team wins: everyone except imposter +2
      memberIds.forEach(id => {
        if (id !== g.imposter) members[id] = { ...members[id], score: (members[id].score || 0) + 2 };
      });
    } else {
      // Imposter wins: +3
      if (members[g.imposter]) members[g.imposter] = { ...members[g.imposter], score: (members[g.imposter].score || 0) + 3 };
    }
    await updateGame(codeRef.current, {
      status: "result",
      voteResult: { topId, topName: g.members[topId]?.name, isCorrect },
      members,
    });
  }

  // ─── Imposter guesses the word ────────────────────────────────────────────
  async function submitImposterRaad() {
    if (!imposterRaad.trim()) return;
    const g = await readGame(codeRef.current);
    const correct = imposterRaad.trim().toLowerCase() === g.word?.toLowerCase();
    const members = { ...g.members };
    if (correct && members[g.imposter]) {
      members[g.imposter] = { ...members[g.imposter], score: (members[g.imposter].score || 0) + 1 };
    }
    await updateGame(codeRef.current, {
      imposterRaadResultaat: { woord: imposterRaad.trim(), correct },
      members,
    });
    setImposterGeraden(true);
  }

  // ─── Next round ───────────────────────────────────────────────────────────
  async function nextRound() {
    const g = await readGame(codeRef.current);
    await updateGame(codeRef.current, {
      status: "lobby",
      ronde: (g.ronde || 1) + 1,
      word: null, track: null, imposter: null,
      hints: {}, votes: {}, voteResult: null, imposterRaadResultaat: null,
    });
  }

  function resetRound() {
    setMyHint(""); setHintIngediend(false);
    setMyStem(null); setStemIngediend(false);
    setRevealIdx(0); setRevealShowing(false);
    setImposterRaad(""); setImposterGeraden(false);
  }

  // ─── Spotify actions ──────────────────────────────────────────────────────
  async function doSpotifySearch() {
    if (!spotifySearch.trim() || !spotifyToken) return;
    setSpotifySearching(true);
    const results = await searchSpotify(spotifySearch, spotifyToken);
    setSpotifyResults(results);
    setSpotifySearching(false);
  }

  async function selectTrack(track) {
    await updateGame(codeRef.current, {
      track: { id: track.id, uri: track.uri, name: track.name, artist: track.artists[0]?.name, preview: track.preview_url, image: track.album?.images[0]?.url }
    });
    setSpotifyResults([]);
    setSpotifySearch("");
  }

  async function playMusic() {
    const g = await readGame(codeRef.current);
    if (!g?.track?.uri || !spotifyToken) return;
    try {
      await playTrack(g.track.uri, spotifyToken, spotifyDeviceId);
      setSpotifyPlaying(true);
      await updateGame(codeRef.current, { musicPlaying: true });
      setTimeout(async () => {
        await pauseTrack(spotifyToken);
        setSpotifyPlaying(false);
        await updateGame(codeRef.current, { musicPlaying: false });
      }, 30000);
    } catch (e) { setErr("Spotify fout: " + e.message); }
  }

  function reset() {
    if (unsubRef.current) unsubRef.current();
    clearSession(); codeRef.current = null;
    setGame(null); setIsHost(false); setErr(""); setName(""); setJoinCode("");
    resetRound(); setScreen("home");
  }

  // ─── Derived ──────────────────────────────────────────────────────────────
  const members     = game?.members ? Object.entries(game.members).map(([id, m]) => ({ id, ...m })) : [];
  const myMember    = game?.members?.[myId];
  const iAmImposter = myMember?.isImposter || false;
  const hints       = game?.hints ? Object.values(game.hints) : [];
  const votes       = game?.votes || {};
  const voteResult  = game?.voteResult;
  const track       = game?.track;
  const word        = game?.word;
  const mode        = game?.mode || "word";
  const imposterName = game?.members?.[game?.imposter]?.name || "?";
  const memberList  = members.sort((a, b) => a.name.localeCompare(b.name));
  const revealMember = memberList[revealIdx];
  const scores      = members.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Styles
  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 };
  const btnPurple = { background: `linear-gradient(135deg,#7c3aed,${C.purple})`, border: "none", borderRadius: 12, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 16, padding: "14px 0", width: "100%", cursor: "pointer" };
  const btnGhost  = { background: "rgba(255,255,255,.06)", border: `1px solid ${C.border}`, borderRadius: 12, color: C.muted, fontFamily: "inherit", fontSize: 14, padding: "12px 0", width: "100%", cursor: "pointer" };
  const btnGreen  = { background: `linear-gradient(135deg,#15803d,${C.green})`, border: "none", borderRadius: 12, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 16, padding: "14px 0", width: "100%", cursor: "pointer" };
  const btnSpotify = { background: `linear-gradient(135deg,#158040,${C.spotify})`, border: "none", borderRadius: 12, color: "#000", fontFamily: "inherit", fontWeight: 700, fontSize: 15, padding: "12px 0", width: "100%", cursor: "pointer" };
  const btnRed    = { background: `linear-gradient(135deg,#7a0000,${C.red})`, border: "none", borderRadius: 12, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 15, padding: "12px 0", width: "100%", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'Inter',system-ui,sans-serif", minHeight: "100dvh", maxWidth: 430, margin: "0 auto", background: C.bg, color: C.text, overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:0}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes fadeInBig{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes wave{0%{transform:scaleY(1)}25%{transform:scaleY(2)}50%{transform:scaleY(.5)}75%{transform:scaleY(1.5)}100%{transform:scaleY(1)}}
        .fa{animation:fadeIn .3s ease both}
        .fab{animation:fadeInBig .4s ease both}
        .btn{border:none;cursor:pointer;transition:all .15s;font-family:inherit}
        .btn:active{transform:scale(.96);opacity:.85}
        input,textarea{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#e8e6f0;font-family:inherit;font-size:15px;padding:11px 13px;width:100%;outline:none;resize:none}
        input:focus,textarea:focus{border-color:rgba(168,85,247,.4)}
        input::placeholder,textarea::placeholder{color:#3a3858}
        select{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#e8e6f0;font-family:inherit;font-size:15px;padding:11px 13px;width:100%;outline:none}
        select option{background:#14141f}
      `}</style>

      {/* ══ LOADING ══ */}
      {restoring && (
        <div style={{ minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div style={{ width:36,height:36,border:`3px solid ${C.faint}`,borderTop:`3px solid ${C.purple}`,borderRadius:"50%",animation:"spin 1s linear infinite" }}/>
        </div>
      )}

      {/* ══ HOME ══ */}
      {!restoring && screen==="home" && (
        <div style={{ minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px" }}>
          <div className="fa" style={{ textAlign:"center",marginBottom:44 }}>
            <div style={{ fontSize:80,marginBottom:12,animation:"float 3s ease-in-out infinite" }}>🕵️</div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:48,fontWeight:700,color:C.purpleLight,letterSpacing:-1 }}>Imposter</div>
            <div style={{ fontSize:13,color:C.muted,marginTop:8,letterSpacing:.5 }}>Woord & Muziek party game</div>
          </div>

          <div className="fa" style={{ width:"100%",display:"flex",flexDirection:"column",gap:12,animationDelay:".1s" }}>
            <div>
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:8 }}>JOUW NAAM</div>
              <input value={name} onChange={e=>{setName(e.target.value);setErr("");}} placeholder="bijv. Sophie" maxLength={18}/>
            </div>
            {err&&<div style={{ color:C.red,fontSize:13,textAlign:"center" }}>{err}</div>}
            <button className="btn" onClick={()=>{if(!name.trim())return setErr("Voer eerst een naam in");createGame();}} style={{ ...btnPurple,fontSize:18,padding:"16px 0" }}>
              🎭 PARTY AANMAKEN
            </button>
            <div style={{ display:"flex",gap:10,alignItems:"center" }}>
              <input value={joinCode} onChange={e=>{setJoinCode(e.target.value.toUpperCase());setErr("");}} placeholder="Code (bijv. XK3P2)" maxLength={10} style={{ fontSize:20,letterSpacing:5,textAlign:"center" }}/>
              <button className="btn" onClick={()=>{if(!name.trim())return setErr("Voer eerst een naam in");joinGame();}} style={{ background:"rgba(168,85,247,.15)",border:`1px solid ${C.borderPurple}`,borderRadius:10,color:C.purpleLight,fontSize:15,padding:"11px 18px",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit",fontWeight:600 }}>
                JOIN →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ LOBBY ══ */}
      {!restoring && screen==="lobby" && game && (
        <div style={{ padding:"24px 20px 40px",minHeight:"100dvh" }}>
          {/* Code */}
          <div className="fa" style={{ ...card,borderColor:C.borderPurple,textAlign:"center",padding:"20px 16px",marginBottom:20 }}>
            <div style={{ fontSize:10,color:C.muted,letterSpacing:5,marginBottom:4 }}>PARTYCODE</div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:52,color:C.purpleLight,letterSpacing:10,fontWeight:700 }}>{game.code}</div>
            <div style={{ fontSize:12,color:C.muted,marginTop:4 }}>{members.length} speler{members.length!==1?"s":""} · Ronde {game.ronde||1}</div>
          </div>

          {/* Spelers */}
          <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:10 }}>SPELERS</div>
          {members.map(m=>(
            <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ fontSize:22 }}>🙋</div>
              <div style={{ flex:1,fontSize:15 }}>{m.name}</div>
              <div style={{ fontSize:13,color:C.purple,fontWeight:600 }}>{m.score||0} pt</div>
            </div>
          ))}

          {isHost && (
            <div style={{ marginTop:20 }}>
              {/* Mode kiezen */}
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:12 }}>GAMEMODE</div>
              <div style={{ display:"flex",gap:10,marginBottom:16 }}>
                {[["word","💬 Woord"],["music","🎵 Muziek"]].map(([m,l])=>(
                  <button key={m} className="btn" onClick={()=>setGameMode(m)} style={{ flex:1,padding:"12px 0",borderRadius:12,border:`1px solid ${gameMode===m?C.borderPurple:C.border}`,background:gameMode===m?"rgba(168,85,247,.12)":"rgba(255,255,255,.04)",color:gameMode===m?C.purpleLight:C.muted,fontFamily:"inherit",fontSize:15,fontWeight:600,cursor:"pointer" }}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Woord modus instellingen */}
              {gameMode==="word" && (
                <div style={{ ...card,borderColor:C.borderPurple,marginBottom:16 }}>
                  <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:10 }}>WOORD INSTELLINGEN</div>
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:12,color:C.muted,marginBottom:6 }}>Categorie</div>
                    <select value={selectedCat} onChange={e=>setSelectedCat(e.target.value)}>
                      {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:12,color:C.muted,marginBottom:6 }}>Of eigen woord</div>
                    <input value={customWord} onChange={e=>setCustomWord(e.target.value)} placeholder="Eigen woord (optioneel)..."/>
                  </div>
                  {showWordToHost && word && (
                    <div style={{ marginTop:10,padding:"10px 14px",background:"rgba(168,85,247,.1)",borderRadius:10,fontSize:15,color:C.purpleLight,textAlign:"center" }}>
                      Het woord is: <strong>{word}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* Muziek modus instellingen */}
              {gameMode==="music" && (
                <div style={{ ...card,borderColor:C.borderSpotify,marginBottom:16 }}>
                  <div style={{ fontSize:11,color:C.spotify,letterSpacing:3,marginBottom:10 }}>🎵 SPOTIFY MUZIEK</div>
                  {!spotifyToken ? (
                    <a href={getSpotifyAuthUrl()} style={{ display:"block",textAlign:"center",padding:"12px 0",background:`linear-gradient(135deg,#158040,${C.spotify})`,borderRadius:10,color:"#000",textDecoration:"none",fontWeight:700,fontSize:15 }}>
                      Inloggen met Spotify
                    </a>
                  ) : (
                    <>
                      <div style={{ display:"flex",gap:8,marginBottom:10 }}>
                        <input value={spotifySearch} onChange={e=>setSpotifySearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSpotifySearch()} placeholder="Zoek een nummer..." style={{ flex:1 }}/>
                        <button className="btn" onClick={doSpotifySearch} style={{ ...btnSpotify,width:"auto",padding:"11px 16px",fontSize:14 }}>
                          {spotifySearching?"...":"🔍"}
                        </button>
                      </div>
                      {spotifyResults.map(t=>(
                        <button key={t.id} className="btn" onClick={()=>selectTrack(t)} style={{ ...card,display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",cursor:"pointer",marginBottom:6 }}>
                          {t.album?.images[1]&&<img src={t.album.images[1].url} alt="" style={{ width:42,height:42,borderRadius:6,objectFit:"cover" }}/>}
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:14,color:C.text }}>{t.name}</div>
                            <div style={{ fontSize:12,color:C.muted }}>{t.artists[0]?.name}</div>
                          </div>
                        </button>
                      ))}
                      {track && (
                        <div style={{ ...card,borderColor:C.borderSpotify,display:"flex",alignItems:"center",gap:12,marginTop:4 }}>
                          {track.image&&<img src={track.image} alt="" style={{ width:48,height:48,borderRadius:8,objectFit:"cover" }}/>}
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:13,color:C.spotify }}>✓ Geselecteerd</div>
                            <div style={{ fontSize:14,color:C.text }}>{track.name}</div>
                            <div style={{ fontSize:12,color:C.muted }}>{track.artist}</div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {err&&<div style={{ color:C.red,fontSize:13,marginBottom:10,textAlign:"center" }}>{err}</div>}
              <button className="btn" onClick={startRound} style={{ ...btnPurple,fontSize:18,padding:"15px 0" }}>
                🎭 RONDE STARTEN
              </button>
            </div>
          )}

          {!isHost && (
            <div style={{ marginTop:24,textAlign:"center",color:C.muted,fontSize:14,animation:"pulse 2s infinite" }}>
              Wachten op de host om de ronde te starten...
            </div>
          )}

          <button className="btn" onClick={reset} style={{ ...btnGhost,marginTop:16 }}>Verlaten</button>
        </div>
      )}

      {/* ══ REVEAL: iedereen ziet hun woord ══ */}
      {!restoring && screen==="reveal" && game && (
        <div style={{ minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px" }}>
          <div className="fa" style={{ textAlign:"center",marginBottom:20 }}>
            <div style={{ fontSize:11,color:C.muted,letterSpacing:4,marginBottom:8 }}>GEEF DE TELEFOON AAN</div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:36,fontWeight:700,color:C.purpleLight }}>{revealMember?.name}</div>
            <div style={{ fontSize:13,color:C.muted,marginTop:4 }}>Speler {revealIdx+1} van {memberList.length}</div>
          </div>

          {!revealShowing ? (
            <button className="btn" onClick={()=>setRevealShowing(true)} style={{ ...btnPurple,width:"100%",fontSize:18,padding:"18px 0" }}>
              👁️ Tik om te zien
            </button>
          ) : (
            <div className="fab" style={{ width:"100%",textAlign:"center" }}>
              {/* Show word or imposter screen */}
              {revealMember?.isImposter ? (
                <div style={{ ...card,borderColor:C.borderRed,background:"rgba(239,68,68,.1)",padding:"32px 16px",marginBottom:20 }}>
                  <div style={{ fontSize:60,marginBottom:12 }}>🕵️</div>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:26,color:C.red,fontWeight:700,marginBottom:8 }}>JIJ BENT DE IMPOSTER!</div>
                  <div style={{ fontSize:14,color:"rgba(239,68,68,.7)",fontStyle:"italic" }}>
                    {mode==="word"?"Je hebt geen woord. Doe mee met de hints en probeer niet op te vallen!":"Je hoort geen muziek. Doe alsof je hem kent en probeer niet op te vallen!"}
                  </div>
                </div>
              ) : (
                <div style={{ ...card,borderColor:C.borderPurple,background:"rgba(168,85,247,.1)",padding:"32px 16px",marginBottom:20 }}>
                  {mode==="word" ? (
                    <>
                      <div style={{ fontSize:14,color:C.muted,letterSpacing:3,marginBottom:10 }}>HET WOORD IS</div>
                      <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:44,fontWeight:700,color:C.purpleLight }}>{word}</div>
                      <div style={{ fontSize:13,color:C.muted,marginTop:10,fontStyle:"italic" }}>Geef een hint zonder het woord te zeggen!</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize:14,color:C.muted,letterSpacing:3,marginBottom:10 }}>HET NUMMER IS</div>
                      {track?.image&&<img src={track.image} alt="" style={{ width:100,height:100,borderRadius:12,objectFit:"cover",marginBottom:10 }}/>}
                      <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:700,color:C.purpleLight }}>{track?.name}</div>
                      <div style={{ fontSize:14,color:C.muted,marginTop:4 }}>{track?.artist}</div>
                      <div style={{ fontSize:13,color:C.muted,marginTop:10,fontStyle:"italic" }}>Je hoort zo zo meteen 30 sec van het nummer!</div>
                    </>
                  )}
                </div>
              )}
              <button className="btn" onClick={()=>setRevealShowing(false)} style={{ ...btnGhost,marginBottom:10,fontSize:13 }}>
                🙈 Verberg
              </button>
              <button className="btn" onClick={nextReveal} style={{ ...btnPurple,fontSize:16,padding:"14px 0" }}>
                {revealIdx < memberList.length-1 ? `Volgende: ${memberList[revealIdx+1]?.name} →` : "▶️ Start de ronde!"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ GAME: HINTS ══ */}
      {!restoring && screen==="game" && game && (
        <div style={{ padding:"24px 20px 80px",minHeight:"100dvh" }}>
          {/* Header */}
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20 }}>
            <div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:18,color:iAmImposter?C.red:C.purpleLight,fontWeight:700 }}>
                {iAmImposter?"🕵️ Imposter":"🎭 Speler"}
              </div>
              <div style={{ fontSize:12,color:C.muted,marginTop:2 }}>{myMember?.name} · Ronde {game.ronde}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:10,color:C.muted,letterSpacing:2 }}>JOUW SCORE</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:22,color:C.purple,fontWeight:700 }}>{myMember?.score||0} pt</div>
            </div>
          </div>

          {/* Jouw woord reminder */}
          {!iAmImposter && (
            <div style={{ ...card,borderColor:C.borderPurple,background:"rgba(168,85,247,.07)",textAlign:"center",marginBottom:16 }}>
              {mode==="word" ? (
                <>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:3,marginBottom:6 }}>HET WOORD</div>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:32,color:C.purpleLight,fontWeight:700 }}>{word}</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:3,marginBottom:8 }}>HET NUMMER</div>
                  <div style={{ fontSize:15,color:C.purpleLight,fontWeight:600 }}>{track?.name}</div>
                  <div style={{ fontSize:13,color:C.muted }}>{track?.artist}</div>
                </>
              )}
            </div>
          )}

          {iAmImposter && (
            <div style={{ ...card,borderColor:C.borderRed,background:"rgba(239,68,68,.07)",textAlign:"center",marginBottom:16 }}>
              <div style={{ fontSize:28,marginBottom:6 }}>🕵️</div>
              <div style={{ fontSize:14,color:C.red,fontWeight:600 }}>Jij bent de Imposter!</div>
              <div style={{ fontSize:12,color:"rgba(239,68,68,.6)",marginTop:4,fontStyle:"italic" }}>
                {mode==="word"?"Je hebt geen woord — probeer niet op te vallen!":"Je hebt de muziek niet gehoord — probeer niet op te vallen!"}
              </div>
            </div>
          )}

          {/* Muziek afspelen (host only) */}
          {isHost && mode==="music" && track && (
            <div style={{ ...card,borderColor:C.borderSpotify,marginBottom:16 }}>
              <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                {track.image&&<img src={track.image} alt="" style={{ width:48,height:48,borderRadius:8,objectFit:"cover" }}/>}
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14,color:C.text }}>{track.name}</div>
                  <div style={{ fontSize:12,color:C.muted }}>{track.artist}</div>
                </div>
                {/* Equalizer animation when playing */}
                {spotifyPlaying && (
                  <div style={{ display:"flex",gap:3,alignItems:"flex-end",height:24 }}>
                    {[1,2,3,4].map(i=>(
                      <div key={i} style={{ width:4,height:"100%",background:C.spotify,borderRadius:2,animation:`wave ${.3+i*.1}s ease-in-out infinite`,animationDelay:`${i*.1}s` }}/>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn" onClick={playMusic} disabled={spotifyPlaying} style={{ ...btnSpotify,marginTop:10,opacity:spotifyPlaying?.6:1,fontSize:14 }}>
                {spotifyPlaying?"🎵 Speelt 30 sec...":"▶️ Speel voor iedereen (30 sec)"}
              </button>
              <div style={{ fontSize:11,color:C.muted,marginTop:6,textAlign:"center",fontStyle:"italic" }}>De imposter hoort niks — maar ziet dit scherm ook niet.</div>
            </div>
          )}

          {/* Hints invoeren */}
          <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:10 }}>JOUW HINT</div>
          {!hintIngediend ? (
            <div style={{ ...card }}>
              <textarea rows={2} value={myHint} onChange={e=>setMyHint(e.target.value)} placeholder="Typ één woord of korte hint..."/>
              <button className="btn" onClick={submitHint} style={{ ...btnPurple,marginTop:10,opacity:myHint.trim()?1:.4,fontSize:15,padding:"12px 0" }}>
                ✓ Hint Indienen
              </button>
            </div>
          ) : (
            <div style={{ ...card,borderColor:C.borderGreen,textAlign:"center" }}>
              <div style={{ fontSize:13,color:C.green }}>✓ Jouw hint: <strong>"{myHint}"</strong></div>
            </div>
          )}

          {/* Alle ingediende hints */}
          {hints.length>0 && (
            <>
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,margin:"18px 0 10px" }}>HINTS ({hints.length}/{members.length})</div>
              {hints.map((h,i)=>(
                <div key={i} style={{ ...card,display:"flex",alignItems:"center",gap:12 }}>
                  <div style={{ fontSize:20 }}>💬</div>
                  <div>
                    <div style={{ fontSize:13,color:C.muted }}>{h.name}</div>
                    <div style={{ fontSize:16,color:C.text,fontWeight:600 }}>"{h.hint}"</div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Host: naar stemmen */}
          {isHost && hints.length>0 && (
            <button className="btn" onClick={moveToVoting} style={{ ...btnGreen,marginTop:16,fontSize:16,padding:"14px 0" }}>
              🗳️ Naar het Stemmen →
            </button>
          )}
        </div>
      )}

      {/* ══ VOTE ══ */}
      {!restoring && screen==="vote" && game && (
        <div style={{ padding:"24px 20px 80px",minHeight:"100dvh" }}>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:24,fontWeight:700,marginBottom:4 }}>🗳️ Wie is de Imposter?</div>
          <div style={{ fontSize:13,color:C.muted,marginBottom:20 }}>Stem op wie jij denkt dat de imposter is.</div>

          {/* Hints overzicht */}
          {hints.length>0 && (
            <div style={{ ...card,marginBottom:16 }}>
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:10 }}>ALLE HINTS</div>
              {hints.map((h,i)=>(
                <div key={i} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.faint}`,fontSize:14 }}>
                  <span style={{ color:C.muted }}>{h.name}</span>
                  <span style={{ color:C.text,fontWeight:600 }}>"{h.hint}"</span>
                </div>
              ))}
            </div>
          )}

          {!stemIngediend ? (
            <>
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:10 }}>STEM OP</div>
              {members.filter(m=>m.id!==myId).map(m=>(
                <button key={m.id} className="btn" onClick={()=>submitVote(m.id)} style={{ ...card,display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",cursor:"pointer",marginBottom:8,padding:"14px 16px" }}>
                  <div style={{ fontSize:22 }}>🙋</div>
                  <div style={{ fontSize:16,color:C.text,fontWeight:500 }}>{m.name}</div>
                </button>
              ))}
            </>
          ) : (
            <div style={{ ...card,borderColor:C.borderGreen,textAlign:"center",padding:"20px 16px" }}>
              <div style={{ fontSize:36,marginBottom:8 }}>✅</div>
              <div style={{ fontSize:14,color:C.green }}>Stem uitgebracht!</div>
              <div style={{ fontSize:12,color:C.muted,marginTop:4 }}>Wacht op de anderen...</div>
            </div>
          )}

          {/* Stemmen teller */}
          <div style={{ ...card,marginTop:12 }}>
            <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:8 }}>STEMMEN ({Object.keys(votes).length}/{members.length})</div>
            {members.map(m=>(
              <div key={m.id} style={{ display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.faint}`,fontSize:14 }}>
                <span style={{ color:votes[m.id]?C.muted:C.text }}>{m.name}{votes[m.id]?" ✓":""}</span>
              </div>
            ))}
          </div>

          {isHost && Object.keys(votes).length>0 && (
            <button className="btn" onClick={processVotes} style={{ ...btnPurple,marginTop:16,fontSize:16,padding:"14px 0" }}>
              📊 Stemmen Verwerken →
            </button>
          )}
        </div>
      )}

      {/* ══ RESULT ══ */}
      {!restoring && screen==="result" && game && (
        <div style={{ padding:"24px 20px 80px",minHeight:"100dvh" }}>
          {/* Stemresultaat */}
          {voteResult && (
            <div className="fab" style={{ ...card,textAlign:"center",padding:"28px 16px",borderColor:voteResult.isCorrect?C.borderGreen:C.borderRed,background:voteResult.isCorrect?"rgba(34,197,94,.07)":"rgba(239,68,68,.07)",marginBottom:16 }}>
              <div style={{ fontSize:56,marginBottom:12 }}>{voteResult.isCorrect?"🎉":"😱"}</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:700,color:voteResult.isCorrect?C.green:C.red,marginBottom:8 }}>
                {voteResult.isCorrect?"Imposter gepakt!":"Imposter ontsnapt!"}
              </div>
              <div style={{ fontSize:15,color:C.muted,marginBottom:4 }}>
                {voteResult.isCorrect
                  ?<>De groep stemde op <strong style={{ color:C.text }}>{voteResult.topName}</strong> — dat was inderdaad de imposter!</>
                  :<>De groep stemde op <strong style={{ color:C.text }}>{voteResult.topName}</strong> — maar dat was <em>niet</em> de imposter!</>
                }
              </div>
              <div style={{ fontSize:14,color:C.purple,marginTop:8 }}>
                De imposter was: <strong style={{ color:C.purpleLight }}>{imposterName}</strong>
              </div>
              {mode==="word"&&<div style={{ fontSize:14,color:C.muted,marginTop:4 }}>Het woord was: <strong style={{ color:C.text }}>{word}</strong></div>}
              {mode==="music"&&<div style={{ fontSize:14,color:C.muted,marginTop:4 }}>Het nummer was: <strong style={{ color:C.text }}>{track?.name} — {track?.artist}</strong></div>}
            </div>
          )}

          {/* Imposter raadt het woord */}
          {voteResult?.isCorrect && mode==="word" && (
            <div style={{ ...card,borderColor:C.borderPurple,marginBottom:16 }}>
              <div style={{ fontSize:13,color:C.purple,fontWeight:600,marginBottom:8 }}>🕵️ {imposterName} mag het woord raden voor +1 punt!</div>
              {!imposterGeraden ? (
                <>
                  <div style={{ fontSize:12,color:C.muted,marginBottom:8 }}>Geef de telefoon aan de imposter.</div>
                  <input value={imposterRaad} onChange={e=>setImposterRaad(e.target.value)} placeholder="Wat was het woord?" style={{ marginBottom:8 }}/>
                  <button className="btn" onClick={submitImposterRaad} style={{ ...btnPurple,fontSize:14,padding:"11px 0",opacity:imposterRaad.trim()?1:.4 }}>
                    Raden!
                  </button>
                </>
              ) : (
                <div style={{ textAlign:"center",padding:"10px 0" }}>
                  {game.imposterRaadResultaat?.correct
                    ? <div style={{ color:C.green,fontSize:15 }}>✓ Correct! +1 punt voor {imposterName}!</div>
                    : <div style={{ color:C.red,fontSize:15 }}>✗ Fout! Het woord was <strong>{word}</strong>.</div>
                  }
                </div>
              )}
            </div>
          )}

          {/* Scorebord */}
          <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:18,fontWeight:700,marginBottom:12 }}>🏆 Scorebord</div>
          {scores.map((m,i)=>(
            <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12,borderColor:i===0?C.borderPurple:C.border }}>
              <div style={{ fontSize:20 }}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":"  "}</div>
              <div style={{ flex:1,fontSize:15,color:i===0?C.purpleLight:C.text }}>{m.name}</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:20,fontWeight:700,color:i===0?C.purple:C.muted }}>{m.score||0} pt</div>
            </div>
          ))}

          {isHost && (
            <div style={{ marginTop:20,display:"flex",flexDirection:"column",gap:10 }}>
              <button className="btn" onClick={nextRound} style={{ ...btnPurple,fontSize:17,padding:"15px 0" }}>
                🔄 Volgende Ronde
              </button>
              <button className="btn" onClick={reset} style={btnGhost}>Spel beëindigen</button>
            </div>
          )}
          {!isHost && (
            <div style={{ marginTop:20,textAlign:"center",color:C.muted,fontSize:14,animation:"pulse 2s infinite" }}>
              Wachten op de host...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
