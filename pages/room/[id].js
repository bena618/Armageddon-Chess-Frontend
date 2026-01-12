import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

let ChessJS = null;

export default function Room() {
  const router = useRouter();
  const { id: queryId } = router.query;

  const [state, setState] = useState(null);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bidMinutes, setBidMinutes] = useState('0');
  const [bidSeconds, setBidSeconds] = useState('0');
  const [boardFen, setBoardFen] = useState('start');
  const localGameRef = useRef(null);
  const [pgn, setPgn] = useState('');
  const [liveWhiteMs, setLiveWhiteMs] = useState(null);
  const [liveBlackMs, setLiveBlackMs] = useState(null);
  const [gameOverInfo, setGameOverInfo] = useState(null);
  const [message, setMessage] = useState(null);
  const [promotionPending, setPromotionPending] = useState(null);
  const playerIdRef = useRef(null);
  const wsRef = useRef(null);
  const shortPollRef = useRef(null);
  const shortPollTimeoutRef = useRef(null);
  const timeForfeitSentRef = useRef(false);

  const roomIdRef = useRef(null);

  // display ID (from URL) is stored in roomIdRef; backend expects full id prefixed with 'room-'
  const getBackendRoomId = () => {
    const rid = roomIdRef.current || queryId || '';
    return rid.startsWith('room-') ? rid : 'room-' + rid;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // detect /room/<id> from the pathname directly so refresh preserves auto-join
    const path = window.location.pathname || '';
    const m = path.match(/^\/room\/([^\/]+)/);
    if (!m) {
      setLoading(false);
      return;
    }
    const pathId = m[1];

    if (!roomIdRef.current) {
      roomIdRef.current = pathId;
      console.log('Locked room ID from path:', roomIdRef.current);
    }

    const roomId = roomIdRef.current;
    if (!roomId) {
      setError('Invalid room URL');
      return;
    }

    const savedName = localStorage.getItem('playerName');
    const savedPlayerId = localStorage.getItem('playerId');

    if (savedName && savedPlayerId) {
      setName(savedName);
      playerIdRef.current = savedPlayerId;
      autoJoin(savedPlayerId, savedName);
    } else {
      setLoading(false);
    }
  }, []);

  function Countdown({ deadline, totalMs, onExpire }) {
    const [secs, setSecs] = useState(() => deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null);
    const beepedRef = useRef(false);
    useEffect(() => {
      if (!deadline) return;
      const tick = () => {
        const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setSecs(s);
        if (s <= 0) {
          if (onExpire) onExpire();
        }
        if (s <= 5 && !beepedRef.current) {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = 880;
            o.connect(g);
            g.connect(ctx.destination);
            g.gain.value = 0.001;
            o.start();
            g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
            setTimeout(() => { try { o.stop(); ctx.close(); } catch(e){} }, 150);
          } catch (e) {}
          beepedRef.current = true;
        }
      };
      tick();
      const id = setInterval(tick, 250);
      return () => clearInterval(id);
    }, [deadline]);

    if (secs === null) return null;
    const remainingMs = Math.max(0, deadline - Date.now());
    const total = typeof totalMs === 'number' && totalMs > 0 ? totalMs : null;
    const pct = total ? Math.max(0, Math.min(100, Math.round((remainingMs / total) * 100))) : 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 140, height: 10, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#ff8a00', transition: 'width 0.25s linear' }} />
        </div>
        <div style={{ fontSize: 12 }}>{secs}s</div>
      </div>
    );
  }

  function LiveTimer({ deadline, format = 's', onExpire }) {
    const [secs, setSecs] = useState(() => deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null);
    useEffect(() => {
      if (!deadline) return undefined;
      const tick = () => {
        const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setSecs(s);
        if (s <= 0 && onExpire) onExpire();
      };
      tick();
      const id = setInterval(tick, 250);
      return () => clearInterval(id);
    }, [deadline]);

    if (secs === null) return <span>—</span>;
    if (format === 'mm:ss') {
      const mm = Math.floor(secs / 60);
      const ss = String(secs % 60).padStart(2, '0');
      return <span>{mm}:{ss}</span>;
    }
    return <span>{secs}s</span>;
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (ChessJS) return;
    import('chess.js').then((mod) => {
      ChessJS = mod.Chess || mod.default || mod;
      console.log('Chess engine loaded');
    }).catch((e) => {
      console.error('Failed to load chess engine', e);
      setError('Failed to load chess engine');
    });
  }, []);

  async function autoJoin(playerId, playerName) {
    const roomId = getBackendRoomId();
    if (!roomId) {
      setError('No room ID in URL');
      return;
    }

    console.log('Joining room:', roomId, 'with player:', playerName);

    setJoining(true);
    try {
      const res = await fetch(`${BASE}/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName }),
      });

      console.log('Join response status:', res.status);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        setError(err.error || 'Failed to join');
        return;
      }

      localStorage.setItem('playerName', playerName);
      localStorage.setItem('playerId', playerId);

      playerIdRef.current = playerId;
      setJoined(true);

      // Delay WebSocket connection to allow backend to broadcast update
      setTimeout(() => {
        setupWebSocket();
      }, 2000);

      await fetchState(); // Immediate state refresh after successful join
    } catch (e) {
      setError('Network error joining room');
      console.error('Join error:', e);
    } finally {
      setJoining(false);
      setLoading(false);
    }
  }

  function setupWebSocket() {
    const backendId = getBackendRoomId();
    if (!backendId || !playerIdRef.current) return;

    const wsUrl = `${BASE.replace(/^http/, 'ws')}/rooms/${backendId}/ws?playerId=${playerIdRef.current}`;
    console.log('Connecting WS to:', wsUrl);

    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected to room:', backendId);
      fetchState(); // Force immediate state refresh when WS connects
      // start short-lived polling in case a recent join/update wasn't broadcast
      try {
        if (shortPollRef.current) clearInterval(shortPollRef.current);
        if (shortPollTimeoutRef.current) clearTimeout(shortPollTimeoutRef.current);
        shortPollRef.current = setInterval(() => fetchState(), 1000);
        shortPollTimeoutRef.current = setTimeout(() => {
          if (shortPollRef.current) clearInterval(shortPollRef.current);
          shortPollRef.current = null;
        }, 8000);
      } catch (e) {}
    };

    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WS received:', data.type, 'Players:', data.room?.players?.length || 'unknown');
        if (data.type === 'init' || data.type === 'update') {
          const room = data.room;
          if (!room || !room.roomId || room.roomId !== backendId) {
            setError('Room not found or invalid');
            return;
          }
          setState(room);
          updateLocalGameAndClocks(room);
        }
      } catch (e) {
        console.error('WS message error:', e);
      }
    };

    wsRef.current.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      if (event.code !== 1000) {
        setTimeout(setupWebSocket, 3000);
      }
      // clear any short polling
      try { if (shortPollRef.current) clearInterval(shortPollRef.current); shortPollRef.current = null; } catch(e){}
      try { if (shortPollTimeoutRef.current) clearTimeout(shortPollTimeoutRef.current); shortPollTimeoutRef.current = null; } catch(e){}
    };

    wsRef.current.onerror = (e) => {
      console.error('WebSocket error:', e);
      setError('Connection error - trying to reconnect...');
    };
  }

  function updateLocalGameAndClocks(room) {
    if (ChessJS) {
      const game = new ChessJS();
      try {
        if (room.moves && room.moves.length > 0) {
          for (const m of room.moves) {
            try {
              if (typeof m.move === 'string' && m.move.length >= 4) {
                const from = m.move.slice(0,2);
                const to = m.move.slice(2,4);
                const promotion = m.move.length >= 5 ? m.move[4] : undefined;
                if (promotion) game.move({ from, to, promotion });
                else game.move({ from, to });
              } else {
                game.move(m.move);
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
      localGameRef.current = game;
      setBoardFen(game.fen());
      setPgn(game.pgn());

      if (room.phase === 'FINISHED' && room.winnerId) {
        const winner = room.players.find(p => p.id === room.winnerId);
        const color = room.colors ? room.colors[room.winnerId] : null;
        setGameOverInfo({ winnerId: room.winnerId, winnerName: winner ? winner.name : null, color });
      }
    }

    if (room.clocks) {
      const now = Date.now();
      const last = room.clocks.lastTickAt || now;
      const elapsed = Math.max(0, now - last);
      const whiteMs = (room.clocks.whiteRemainingMs || 0) - ((room.clocks.turn === 'white') ? elapsed : 0);
      const blackMs = (room.clocks.blackRemainingMs || 0) - ((room.clocks.turn === 'black') ? elapsed : 0);
      const safeWhite = Math.max(0, whiteMs);
      const safeBlack = Math.max(0, blackMs);
      setLiveWhiteMs(safeWhite);
      setLiveBlackMs(safeBlack);

      // Local timeout detection: update gameOverInfo for immediate UI feedback and notify server
      if (room.phase === 'PLAYING' && !gameOverInfo) {
        if (safeWhite <= 0 && (!room.winnerId)) {
          const winner = room.players && room.players.find(p => room.colors && room.colors[p.id] === 'black');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'black' });
          // notify server once
          if (!timeForfeitSentRef.current) {
            timeForfeitSentRef.current = true;
            sendTimeForfeit(room.players.find(p => p && p && p.id && (room.colors && room.colors[p.id] === 'white'))?.id || null);
          }
        } else if (safeBlack <= 0 && (!room.winnerId)) {
          const winner = room.players && room.players.find(p => room.colors && room.colors[p.id] === 'white');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'white' });
          if (!timeForfeitSentRef.current) {
            timeForfeitSentRef.current = true;
            sendTimeForfeit(room.players.find(p => p && p && p.id && (room.colors && room.colors[p.id] === 'black'))?.id || null);
          }
        }
      }
    }
  }

  async function fetchState() {
    const backendId = getBackendRoomId();
    if (!backendId) return;

    try {
      const res = await fetch(`${BASE}/rooms/${backendId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setMessage('Room no longer exists — sending you back to lobby');
          setTimeout(() => router.replace('/'), 3000);
          return;
        }
        throw new Error('Failed to fetch state');
      }
      const data = await res.json();
      const room = data.room || data;
      console.log('Fetched state - Players:', room.players?.length || 0);
      if (!room || !room.roomId || room.roomId !== backendId) {
        setError('Room not found');
        return;
      }
      // if server marked room closed due to expired start request, inform user and redirect
      if (room.closed) {
        setMessage('Players did not press start — sending you back to lobby');
        setTimeout(() => router.replace('/'), 5000);
      }
      updateLocalGameAndClocks(room);
      setState(room);
    } catch (e) {
      console.error('Fetch error:', e);
      setError('Failed to load room state');
    }
  }

  async function sendTimeForfeit(timedOutPlayerId) {
    const backendId = getBackendRoomId();
    if (!backendId) return;
    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/time-forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timedOutPlayerId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Time-forfeit request failed:', err);
        return;
      }
      await fetchState();
    } catch (e) { console.error('Time-forfeit network error', e); }
  }

  async function sendRematchVote(agree) {
    const backendId = getBackendRoomId();
    if (!backendId) return;
    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/rematch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: playerIdRef.current, agree }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data && data.error) || 'Failed to send rematch vote');
        return;
      }
      setMessage(data.rematchStarted ? 'Rematch started' : 'Vote recorded');
      await fetchState();
    } catch (e) { setError('Network error'); }
  }

  useEffect(() => {
    if (!queryId || !joined) return;

    const interval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        fetchState();
      }
    }, 1000); // 1-second polling for faster testing/debugging

    return () => clearInterval(interval);
  }, [queryId, joined]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!state || !state.clocks || gameOverInfo) return;
      const now = Date.now();
      const last = state.clocks.lastTickAt || now;
      const elapsed = Math.max(0, now - last);
      const whiteMs = (state.clocks.whiteRemainingMs || 0) - ((state.clocks.turn === 'white') ? elapsed : 0);
      const blackMs = (state.clocks.blackRemainingMs || 0) - ((state.clocks.turn === 'black') ? elapsed : 0);
      const safeWhite = Math.max(0, Math.floor(whiteMs));
      const safeBlack = Math.max(0, Math.floor(blackMs));
      setLiveWhiteMs(safeWhite);
      setLiveBlackMs(safeBlack);

      // Local timeout detection while playing
      if (state.phase === 'PLAYING' && !gameOverInfo) {
        if (safeWhite <= 0 && (!state.winnerId)) {
          const winner = state.players && state.players.find(p => state.colors && state.colors[p.id] === 'black');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'black' });
        } else if (safeBlack <= 0 && (!state.winnerId)) {
          const winner = state.players && state.players.find(p => state.colors && state.colors[p.id] === 'white');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'white' });
        }
      }
    }, 500);
    return () => clearInterval(t);
  }, [state, gameOverInfo]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href.replace(/\?.*/, ''));
    setMessage('Link copied!');
  }

  async function join() {
    if (!name.trim()) return;

    setJoining(true);
    const playerId = crypto.randomUUID();
    playerIdRef.current = playerId;

    await autoJoin(playerId, name.trim());
  }

  async function startBidding() {
    const backendId = getBackendRoomId();
    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/start-bidding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: playerIdRef.current }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError('Failed to start bidding: ' + (err.error || res.status));
        return;
      }
      // if server returned startRequestedBy, surface a small message
      const body = await res.json().catch(() => ({}));
      if (body.startRequestedBy && body.startConfirmDeadline) {
        const by = state.players.find(p => p.id === body.startRequestedBy);
        setMessage((by && by.name) ? `${by.name} requested bidding; waiting for confirmation` : 'Bidding requested; waiting for confirmation');
      }
    } catch (e) { setError('Network error'); }
  }

  async function submitBid() {
    const playerId = playerIdRef.current;
    if (!playerId) { setError('Missing player id'); return; }
    const mins = Number(bidMinutes) || 0;
    const secs = Number(bidSeconds) || 0;
    if (!Number.isFinite(mins) || mins < 0) { setError('Invalid minutes'); return; }
    if (!Number.isFinite(secs) || secs < 0 || secs > 59) { setError('Seconds must be between 0 and 59'); return; }
    const ms = Math.floor(mins * 60 * 1000 + secs * 1000);
    if (state && typeof state.mainTimeMs === 'number' && ms > state.mainTimeMs) { setError('Bid cannot exceed game main time'); return; }
    const backendId = getBackendRoomId();
    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/submit-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, amount: ms }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError('Failed to submit bid: ' + (err.error || res.status));
        return;
      }
      setBidMinutes('0');
      setBidSeconds('0');
    } catch (e) { setError('Network error'); }
  }

  async function chooseColor(color) {
    const playerId = playerIdRef.current;
    if (!playerId) { setError('Missing player id'); return; }
    const backendId = getBackendRoomId();
    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/choose-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, color }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError('Failed to choose color: ' + (err.error || res.status));
        return;
      }
    } catch (e) { setError('Network error'); }
  }

  async function makeMoveUci(uci, promotion) {
    const playerId = playerIdRef.current;
    if (!playerId) { setError('Missing player id'); return false; }
    if (!ChessJS) { setError('Chess engine not loaded'); return false; }
    const game = localGameRef.current || new ChessJS();
    const from = uci.slice(0,2);
    const to = uci.slice(2,4);
    const finalUci = promotion ? `${from}${to}${promotion}` : uci;

    const playerColor = state && state.colors ? state.colors[playerId] : null;
    if (!playerColor) { setError('Unknown player color'); return false; }
    const turnLetter = game.turn() === 'w' ? 'white' : 'black';
    if (turnLetter !== playerColor) { setError('Not your turn'); return false; }
    const test = new ChessJS(game.fen());

    const maybePiece = test.get(from);
    const isPawn = maybePiece && maybePiece.type === 'p';
    const targetRank = Number(to[1]);
    const needsPromotion = isPawn && (targetRank === 8 || targetRank === 1);

    if (needsPromotion && !promotion) {
      setPromotionPending({ from, to, uciBase: `${from}${to}` });
      return false;
    }

    let moved;
    try {
      moved = test.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      console.error('Chess engine rejected move:', e);
      setError('Illegal move');
      return false;
    }
    if (!moved) {
      setError('Illegal move');
      return false;
    }

    try {
      game.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      console.error('Failed to apply move to local game:', e);
      setError('Illegal move');
      return false;
    }
    localGameRef.current = game;
    setBoardFen(game.fen());
    setPgn(game.pgn());

    const isGameOver = (typeof game.isGameOver === 'function' && game.isGameOver()) || (typeof game.isCheckmate === 'function' && game.isCheckmate());
    if (isGameOver) {
      const turnAfter = game.turn();
      const winnerColor = turnAfter === 'w' ? 'black' : 'white';
      const winnerId = state && state.colors ? Object.keys(state.colors).find(id => state.colors[id] === winnerColor) : null;
      const winnerName = state && state.players ? (state.players.find(p => p.id === winnerId)?.name || null) : null;
      setGameOverInfo({ winnerId, winnerName, color: winnerColor });
    }

    const backendId = getBackendRoomId();
    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, move: finalUci }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError('Move rejected: ' + (err.error || res.status));
        return false;
      }
      return true;
    } catch (e) {
      setError('Network error');
      return false;
    }
  }

  const pieceMap = {
    'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
    'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'
  };

  // Render pieces as SVGs for crisper visuals and easier styling
  const pieceUnicodeMap = {
    'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
    'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'
  };

  function Piece({ piece }) {
    const glyph = pieceUnicodeMap[piece] || '';
    const isWhite = piece === piece.toUpperCase();
    return (
      <svg width="36" height="36" viewBox="0 0 36 36" style={{ display: 'block' }}>
        <rect x="0" y="0" width="36" height="36" fill="transparent" />
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontSize="24" style={{ fill: isWhite ? '#fff' : '#111', stroke: isWhite ? '#111' : '#fff', strokeWidth: 0.5, fontFamily: 'serif' }}>{glyph}</text>
      </svg>
    );
  }

  function fenToMatrix(fen) {
    const rows = fen.split(' ')[0].split('/');
    return rows.map(r => {
      const arr = [];
      for (const ch of r) {
        if (/[1-8]/.test(ch)) {
          const n = Number(ch);
          for (let i=0;i<n;i++) arr.push(null);
        } else arr.push(ch);
      }
      return arr;
    });
  }

  const [selected, setSelected] = useState(null);
  function Board({fen}){
    const matrix = fen === 'start' ? fenToMatrix('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') : fenToMatrix(fen);
    const myPid = playerIdRef.current;
    const myColor = state && state.colors ? state.colors[myPid] : null;
    const isMyTurnLocal = state && state.clocks && myColor && state.clocks.turn === myColor;

    // compute legal targets for the currently selected square only if it's my turn
    let legalTargets = new Set();
    try {
      if (isMyTurnLocal && selected && ChessJS && localGameRef.current) {
        const g = new ChessJS(localGameRef.current.fen());
        const moves = g.moves({ square: selected, verbose: true }) || [];
        for (const m of moves) legalTargets.add(m.to);
      }
    } catch (e) {}

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,54px)', gap: 0, border: '2px solid #222', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
        {matrix.flatMap((row, rIdx) => row.map((cell, cIdx) => {
          const rank = 8 - rIdx;
          const file = 'abcdefgh'[cIdx];
          const sq = `${file}${rank}`;
          const isLight = (rIdx + cIdx) % 2 === 0;
          const baseColor = isLight ? '#f0d9b5' : '#b58863';
          const isSelected = selected === sq;
          const isTarget = legalTargets.has(sq);
          const bg = isSelected ? '#ffeb99' : (isTarget ? '#9fe29f' : baseColor);
          return (
            <div key={sq}
              onClick={() => {
                // block selection when it's not my turn
                if (!isMyTurnLocal) { setMessage('Not your turn'); return; }
                if (!selected) { setSelected(sq); }
                else {
                  const uci = `${selected}${sq}`;
                  setSelected(null);
                  makeMoveUci(uci);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const from = e.dataTransfer.getData('text/from');
                if (from) {
                  const uci = `${from}${sq}`;
                  setSelected(null);
                  makeMoveUci(uci);
                }
              }}
              style={{ width:54, height:54, display:'flex', alignItems:'center', justifyContent:'center', background: bg, cursor: 'pointer', fontSize: 28, boxSizing: 'border-box', border: isSelected ? '2px solid #f39c12' : '1px solid rgba(0,0,0,0.15)' }}>
              {cell ? (
                <div draggable onDragStart={(e) => { e.dataTransfer.setData('text/from', sq); try { e.dataTransfer.setDragImage(e.currentTarget, 16, 16); } catch(e){} }} style={{ cursor: 'grab', userSelect: 'none' }}>
                  <Piece piece={cell} />
                </div>
              ) : ''}
            </div>
          );
        }))}
      </div>
    );
  }

  function formatMs(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const parts = [];
    if (mins > 0) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
    parts.push(`${secs} second${secs === 1 ? '' : 's'}`);
    return parts.join(' ');
  }

  if (!queryId) {
    return <div className="container">Loading room...</div>;
  }

  if (loading || joining) {
    return <div className="container">{joining ? 'Joining room...' : 'Loading...'}</div>;
  }

  const playerId = playerIdRef.current;
  const amIWinner = state && state.winnerId && playerId === state.winnerId;
  const myColor = state && state.colors ? state.colors[playerId] : null;
  const isMyTurn = state && state.clocks && myColor && state.clocks.turn === myColor;

  return (
    <main className="container">
      <h2>Room {roomIdRef.current || queryId}</h2>

      <div className="share">
        <input readOnly value={typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''} />
        <button onClick={copyLink}>Copy Link</button>
      </div>

      {message && <div style={{ color: 'green', marginTop: 8 }}>{message}</div>}
      {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}

      {promotionPending && (
        <div style={{ marginTop: 8, padding: 8, border: '1px solid #888', display: 'inline-block' }}>
          <div>Choose promotion piece for move {promotionPending.uciBase}:</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => { makeMoveUci(promotionPending.uciBase, 'q'); setPromotionPending(null); setMessage('Promoted to Queen'); }}>Queen</button>
            <button onClick={() => { makeMoveUci(promotionPending.uciBase, 'r'); setPromotionPending(null); setMessage('Promoted to Rook'); }}>Rook</button>
            <button onClick={() => { makeMoveUci(promotionPending.uciBase, 'b'); setPromotionPending(null); setMessage('Promoted to Bishop'); }}>Bishop</button>
            <button onClick={() => { makeMoveUci(promotionPending.uciBase, 'n'); setPromotionPending(null); setMessage('Promoted to Knight'); }}>Knight</button>
          </div>
        </div>
      )}

      {state && state.phase === 'PLAYING' && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          {gameOverInfo ? (
              (() => {
                const info = gameOverInfo || {};
                const nameOrId = info.winnerName || info.winnerId;
                if (nameOrId) return <strong style={{ fontSize: 18 }}>{nameOrId} ({info.color}) wins</strong>;
                if (info.color) return <strong style={{ fontSize: 18 }}>{info.color.charAt(0).toUpperCase() + info.color.slice(1)} wins</strong>;
                return <strong style={{ fontSize: 18 }}>Game over</strong>;
              })()
          ) : (
            <strong style={{ fontSize: 18, color: isMyTurn ? 'green' : 'darkred' }}>{isMyTurn ? 'YOUR TURN' : 'WAITING FOR OPPONENT'}</strong>
          )}
        </div>
      )}

      {!joined && (
        <div className="join">
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            disabled={joining}
          />
          <button onClick={join} disabled={joining || !name.trim()}>
            {joining ? 'Joining...' : 'Join'}
          </button>
          {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
      )}

      {joined && state && (
        <section className="state">
          {typeof window !== 'undefined' && window.location.search.includes('debug=1') ? (
            <div style={{ padding: 8, marginBottom: 8, border: '1px dashed #888', background: '#f7f7ff' }}>
              <strong>Debug:</strong>
              <div>startRequestedBy: {String(state.startRequestedBy || 'null')}</div>
              <div>startConfirmDeadline: {state.startConfirmDeadline ? new Date(state.startConfirmDeadline).toLocaleString() : 'null'}</div>
              <div>choiceDurationMs: {String(state.choiceDurationMs || 'null')}</div>
              <div>closed: {String(!!state.closed)}</div>
              <div>
                remainingMs: {state.startConfirmDeadline ? Math.max(0, state.startConfirmDeadline - Date.now()) : '—'}
                {state.startConfirmDeadline && state.choiceDurationMs ? (' — pct: ' + Math.round(Math.max(0, Math.min(100, ((Math.max(0, state.startConfirmDeadline - Date.now()) / state.choiceDurationMs) * 100))))) + '%' : ''}
              </div>
            </div>
          ) : null}
          <h3>Room State — {state.phase}</h3>

          <div>
            <strong>Players:</strong>
            <ul>
              {state.players.map(p => (
                <li key={p.id}>{p.name || p.id}{state.phase === 'COLOR_PICK' && p.id === state.winnerId ? ' (bid winner)' : ''}</li>
              ))}
            </ul>
          </div>

          {state.phase === 'LOBBY' && (
            <div>
              {state.startRequestedBy ? (
                <div style={{ marginBottom: 8, padding: 8, border: '1px solid #ccc', background: '#fff8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    {state.startRequestedBy === playerId ? (
                      <div>You requested bidding — waiting for opponent</div>
                    ) : (
                      <div>{(state.players.find(p => p.id === state.startRequestedBy)?.name) || state.startRequestedBy} requested bidding — click <strong>Start Bidding</strong> to confirm</div>
                    )}
                  </div>
                  <div>
                    <Countdown deadline={state.startConfirmDeadline} totalMs={state.choiceDurationMs} onExpire={() => setMessage('Start request expired')} />
                  </div>
                </div>
              ) : null}
              <button onClick={startBidding} disabled={state.players.length < state.maxPlayers}>{state.startRequestedBy && state.startRequestedBy !== playerId ? 'Confirm Start' : 'Start Bidding'}</button>
            </div>
          )}

          {state.phase === 'BIDDING' && (
            <div>
              <p>Bid deadline: {state.bidDeadline ? <><LiveTimer deadline={state.bidDeadline} format="mm:ss" /> ({new Date(state.bidDeadline).toLocaleTimeString()})</> : '—'}</p>
              <p>Existing bids:</p>
              <ul>
                {state.players.map(p => {
                  const hasBid = state.bids && state.bids[p.id];
                  if (state.phase === 'BIDDING') {
                    return <li key={p.id}>{p.name || p.id}: {hasBid ? 'Submitted' : (p.id === playerId ? 'You — not submitted' : '—')}</li>;
                  }
                  const amt = hasBid && typeof state.bids[p.id].amount === 'number' ? state.bids[p.id].amount : null;
                  return <li key={p.id}>{p.name || p.id}: {amt ? formatMs(amt) : '—'}</li>;
                })}
              </ul>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12 }}>Minutes</label>
                  <input type="number" min="0" step="1" value={bidMinutes} onChange={(e) => setBidMinutes(e.target.value)} style={{ width: 80 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12 }}>Seconds</label>
                  <input type="number" min="0" max="59" step="1" value={bidSeconds} onChange={(e) => setBidSeconds(e.target.value)} style={{ width: 80 }} />
                </div>
                <div style={{ alignSelf: 'flex-end' }}>
                  <button onClick={submitBid}>Submit Bid</button>
                </div>
              </div>
            </div>
          )}

          {state.phase === 'COLOR_PICK' && (
            <div>
              <p>Winner: {(state.players && state.players.find(p => p.id === state.winnerId) && state.players.find(p => p.id === state.winnerId).name) || state.winnerId || '—'}</p>
              <p>Current picker: {state.currentPicker}</p>
              {(() => {
                const canChoose = (state.currentPicker === 'winner' && playerId === state.winnerId) || (state.currentPicker === 'loser' && playerId === state.loserId);
                if (canChoose) {
                  return (
                    <div>
                      <p>Choose color (black receives draw odds):</p>
                      <button onClick={() => chooseColor('white')}>White</button>
                      <button onClick={() => chooseColor('black')}>Black</button>
                      <p>Time remaining to choose: {state.choiceDeadline ? <LiveTimer deadline={state.choiceDeadline} /> : '—'}</p>
                    </div>
                  );
                }
                return <p>Waiting for {state.currentPicker} to choose a color...</p>;
              })()}
            </div>
          )}

          {(state.phase === 'PLAYING' || state.phase === 'FINISHED') && (
            <div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div>
                  <p>Turn: {state.clocks ? state.clocks.turn : '—'}</p>
                  <p>White: {liveWhiteMs !== null ? Math.ceil(liveWhiteMs/1000) + 's' : (state.clocks ? Math.max(0, Math.floor((state.clocks.whiteRemainingMs || 0) / 1000)) + 's' : '—')}</p>
                  <p>Black: {liveBlackMs !== null ? Math.ceil(liveBlackMs/1000) + 's' : (state.clocks ? Math.max(0, Math.floor((state.clocks.blackRemainingMs || 0) / 1000)) + 's' : '—')}</p>
                </div>
                <div>
                  <div style={{ width: 360 }}>
                    <Board fen={boardFen === 'start' ? 'start' : boardFen} />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <strong>Moves:</strong>
                <pre>{JSON.stringify(state.moves || [], null, 2)}</pre>
              </div>
              <div style={{ marginTop: 8 }}>
                <strong>FEN:</strong>
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{boardFen === 'start' ? (localGameRef.current ? localGameRef.current.fen() : 'start') : boardFen}</div>
                <strong>PGN:</strong>
                <div style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>{pgn}</div>
              </div>

              {state.phase === 'FINISHED' && (
                <div style={{ marginTop: 12, padding: 8, border: '1px solid #ddd', background: '#f7fff7' }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Result:</strong> {gameOverInfo ? `${gameOverInfo.winnerName || gameOverInfo.winnerId || gameOverInfo.color} (${gameOverInfo.color}) wins` : (state.winnerId ? (state.players.find(p => p.id === state.winnerId)?.name || state.winnerId) : 'Game finished')}
                  </div>
                  {state.rematchWindowEnds ? (
                    <div>
                      <div style={{ marginBottom: 8 }}>Rematch voting open — ends in <em><LiveTimer deadline={state.rematchWindowEnds} /></em></div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => sendRematchVote(true)} disabled={state.rematchVotes && state.rematchVotes[playerIdRef.current] === true}>Vote Yes</button>
                        <button onClick={() => sendRematchVote(false)} disabled={state.rematchVotes && state.rematchVotes[playerIdRef.current] === false}>Vote No</button>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        Votes: {state.players.map(p => `${p.name || p.id}: ${state.rematchVotes && typeof state.rematchVotes[p.id] !== 'undefined' ? (state.rematchVotes[p.id] ? 'Yes' : 'No') : '—'}`).join(' | ')}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button onClick={() => sendRematchVote(true)}>Request Rematch</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}