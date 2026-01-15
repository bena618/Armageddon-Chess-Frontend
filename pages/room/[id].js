import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

let ChessJS = null;

// Helper cookie functions
function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\\+^])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name, value, hours) {
  if (typeof document === 'undefined') return;
  const maxAge = (typeof hours === 'number' && hours > 0) ? String(Math.floor(hours * 60 * 60)) : undefined;
  let cookie = `${name}=${encodeURIComponent(value)}; path=/`;
  if (maxAge) cookie += `; max-age=${maxAge}`;
  document.cookie = cookie;
}

export default function Room() {
  const router = useRouter();

  // Safe room ID from URL path (works during static export and client-side)
  const getRoomId = () => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const match = path.match(/^\/room\/(.+)$/);
      return match ? match[1] : null;
    }
    return null;
  };

  const roomId = getRoomId() || router.query.id; // Fallback for runtime

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
  const rejoinAttemptedRef = useRef(false);
  const roomIdRef = useRef(null);
  const [startPending, setStartPending] = useState(false);

  function getStoredPlayerId() {
    if (playerIdRef.current) return playerIdRef.current;
    if (typeof window !== 'undefined') {
      const ls = localStorage.getItem('playerId');
      if (ls) return ls;
      const c = getCookie('playerId');
      if (c) return c;
    }
    return null;
  }

  // Lock room ID from path on first mount (for refresh persistence)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const path = window.location.pathname || '';
    const m = path.match(/^\/room\/([^\/]+)/);
    if (!m) {
      setLoading(false);
      return;
    }
    const pathId = m[1];

    if (!roomIdRef.current) {
      roomIdRef.current = pathId;
    }

    const currentRoomId = roomIdRef.current;
    if (!currentRoomId) {
      setError('Invalid room URL');
      return;
    }

    const savedName = localStorage.getItem('playerName') || getCookie('playerName');
    const savedPlayerId = localStorage.getItem('playerId') || getCookie('playerId');

    if (savedName && savedPlayerId) {
      setName(savedName);
      playerIdRef.current = savedPlayerId;
      autoJoin(savedPlayerId, savedName);
    } else {
      setLoading(false);
    }
  }, []);

  const getBackendRoomId = () => {
    const rid = roomIdRef.current || roomId || '';
    return rid.startsWith('room-') ? rid : (rid ? 'room-' + rid : null);
  };

  function Countdown({ deadline, totalMs, onExpire }) {
    const [secs, setSecs] = useState(() => deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null);
    const beepedRef = useRef(false);
    useEffect(() => {
      if (!deadline) return;
      const tick = () => {
        const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setSecs(s);
        if (s <= 0 && onExpire) onExpire();
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

    setJoining(true);
    try {
      const res = await fetch(`${BASE}/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        setError(err.error || 'Failed to join');
        return;
      }

      localStorage.setItem('playerName', playerName);
      localStorage.setItem('playerId', playerId);
      setCookie('playerName', playerName, 5);
      setCookie('playerId', playerId, 5);

      await fetch(`${BASE}/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName })
      }).catch(e => console.error('Re-join failed:', e));

      playerIdRef.current = playerId;
      setJoined(true);

      setTimeout(setupWebSocket, 2000);
      await fetchState();
    } catch (e) {
      setError('Network error joining room');
    } finally {
      setJoining(false);
      setLoading(false);
    }
  }

  function setupWebSocket() {
    const backendId = getBackendRoomId();
    if (!backendId || !playerIdRef.current) return;

    const wsUrl = `${BASE.replace(/^http/, 'ws')}/rooms/${backendId}/ws?playerId=${playerIdRef.current}`;

    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      fetchState();
      
      // *** HEARTBEAT: Keep connection alive every 5s ***
      const heartbeat = setInterval(async () => {
        try {
          await fetch(`${BASE}/rooms/${getBackendRoomId()}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: playerIdRef.current })
          });
        } catch (e) {
          console.error('Heartbeat failed:', e);
        }
      }, 5000);
      wsRef.current.heartbeatInterval = heartbeat;
      
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

        if (data.type === 'init' || data.type === 'update') {
          const room = data.room;
          if (!room) return;

          if (room.closed) {
            setMessage('Start request expired — returning to lobby');
            setTimeout(() => router.replace('/'), 3000);
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
      // *** CLEANUP HEARTBEAT ***
      if (wsRef.current && wsRef.current.heartbeatInterval) {
        clearInterval(wsRef.current.heartbeatInterval);
        wsRef.current.heartbeatInterval = null;
      }
      
      if (event.code !== 1000) {
        setTimeout(setupWebSocket, 3000);
      }
      try { if (shortPollRef.current) clearInterval(shortPollRef.current); } catch(e){}
      try { if (shortPollTimeoutRef.current) clearTimeout(shortPollTimeoutRef.current); } catch(e){}
    };

    wsRef.current.onerror = (e) => {
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

      if (room.phase === 'FINISHED' && room.clocks.frozenAt) {
        setLiveWhiteMs(room.clocks.whiteRemainingMs || 0);
        setLiveBlackMs(room.clocks.blackRemainingMs || 0);
        return;
      }

      const last = room.clocks.lastTickAt || now;
      const elapsed = Math.max(0, now - last);
      const whiteMs = (room.clocks.whiteRemainingMs || 0) - ((room.clocks.turn === 'white') ? elapsed : 0);
      const blackMs = (room.clocks.blackRemainingMs || 0) - ((room.clocks.turn === 'black') ? elapsed : 0);
      const safeWhite = Math.max(0, whiteMs);
      const safeBlack = Math.max(0, blackMs);
      setLiveWhiteMs(safeWhite);
      setLiveBlackMs(safeBlack);

      if (room.phase === 'PLAYING' && !gameOverInfo) {
        if (safeWhite <= 0 && (!room.winnerId)) {
          const winner = room.players.find(p => room.colors && room.colors[p.id] === 'black');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'black' });
          if (!timeForfeitSentRef.current) {
            timeForfeitSentRef.current = true;
            sendTimeForfeit(room.players.find(p => room.colors && room.colors[p.id] === 'white')?.id || null);
          }
        } else if (safeBlack <= 0 && (!room.winnerId)) {
          const winner = room.players.find(p => room.colors && room.colors[p.id] === 'white');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'white' });
          if (!timeForfeitSentRef.current) {
            timeForfeitSentRef.current = true;
            sendTimeForfeit(room.players.find(p => room.colors && room.colors[p.id] === 'black')?.id || null);
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

      if (!room || !room.roomId || room.roomId !== backendId) {
        setError('Room not found');
        return;
      }

      if (data.startExpired || room.closed) {
        setMessage('Start request expired — returning to lobby');
        setTimeout(() => {
          const playerName =
            localStorage.getItem('playerName') ||
            getCookie('playerName') ||
            name ||
            '';
          router.replace(`/?name=${encodeURIComponent(playerName)}`);
        }, 2000);
        return;
      }

      updateLocalGameAndClocks(room);
      setState(room);

      if (room.phase === 'FINISHED') {
        if (room.result === 'draw') {
          setGameOverInfo({ winnerId: null, winnerName: null, color: null });
          setMessage(`Draw${room.reason ? ` (${room.reason})` : ''}`);
        } else if (room.winnerId) {
          const winner = room.players.find(p => p.id === room.winnerId);
          const color = room.colors ? room.colors[room.winnerId] : null;
          setGameOverInfo({
            winnerId: room.winnerId,
            winnerName: winner ? winner.name : null,
            color
          });
          if (room.result === 'time_forfeit') {
            setMessage('Win on time');
          } else if (room.result === 'checkmate') {
            setMessage('Checkmate');
          } else {
            // Fallback for other finish reasons (e.g. disconnect_forfeit)
            setMessage('Game over');
          }
        } else {
          // Finished with no winner (e.g. aborted game without result/reason)
          setMessage('Game over');
        }
      }

      try {
        const savedPid = getStoredPlayerId();
        const listed =
          savedPid &&
          room.players &&
          room.players.find(p => p.id === savedPid);

        if (savedPid && !listed && !rejoinAttemptedRef.current) {
          rejoinAttemptedRef.current = true;
          const savedName =
            localStorage.getItem('playerName') ||
            getCookie('playerName') ||
            '';
          await autoJoin(savedPid, savedName);
        }
      } catch (e) {
        console.warn('Background rejoin attempt failed', e);
      }
    } catch (e) {
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
      if (!res.ok) return;
      await fetchState();
    } catch (e) {}
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
        setError('Failed to send rematch vote');
        return;
      }
      setMessage(data.rematchStarted ? 'Rematch started' : 'Vote recorded');
      await fetchState();
    } catch (e) { setError('Network error'); }
  }

  useEffect(() => {
    if (!roomId || !joined) return;

    fetchState();
    const interval = setInterval(fetchState, 2000);

    return () => clearInterval(interval);
  }, [roomId, joined]);

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

      if (state.phase === 'PLAYING' && !gameOverInfo) {
        if (safeWhite <= 0 && (!state.winnerId)) {
          const winner = state.players.find(p => state.colors && state.colors[p.id] === 'black');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'black' });
        } else if (safeBlack <= 0 && (!state.winnerId)) {
          const winner = state.players.find(p => state.colors && state.colors[p.id] === 'white');
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
    if (startPending) return;

    const backendId = getBackendRoomId();
    setStartPending(true);
    setMessage('Requesting start... waiting for opponent');

    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/start-bidding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: playerIdRef.current }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage('Failed to request start');
        setStartPending(false);
        return;
      }

      setStartPending(true);
    } catch (e) {
      setMessage('Network error');
      setStartPending(false);
    }
  }

  async function submitBid() {
    const minutes = parseInt(bidMinutes, 10);
    const seconds = parseInt(bidSeconds, 10);
    if (isNaN(minutes) || isNaN(seconds) || (minutes === 0 && seconds === 0)) {
      setMessage('Invalid bid time');
      return;
    }

    const amountMs = (minutes * 60 + seconds) * 1000;

    const backendId = getBackendRoomId();
    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/submit-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: playerIdRef.current,
          amount: amountMs,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage('Bid failed: ' + (err.error || 'Unknown error'));
        return;
      }

      setMessage('Bid submitted!');
      await fetchState();
    } catch (e) {
      setMessage('Network error submitting bid');
    }
  }

  useEffect(() => {
    if (!roomId || !joined) return;

    const fetchAndCheck = async () => {
      await fetchState(); 
    };

    fetchAndCheck();
    const interval = setInterval(fetchAndCheck, startPending ? 1000 : 2000);

    return () => clearInterval(interval);
  }, [roomId, joined, startPending]);

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

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError('Move rejected: ' + (data.error || res.status));
        return false;
      }

      if (data.result) {
        if (data.result === 'draw') {
          setGameOverInfo({ winnerId: null, winnerName: null, color: null });
          setMessage(`Draw${data.reason ? ` (${data.reason})` : ''}`);
        } else if (data.result === 'checkmate' || data.result === 'time_forfeit') {
          const winnerId = data.winnerId || null;
          const winner = state && state.players ? state.players.find(p => p.id === winnerId) : null;
          const color = state && state.colors && winnerId ? state.colors[winnerId] : null;
          setGameOverInfo({ winnerId, winnerName: winner ? winner.name : null, color });
          setMessage(
            data.result === 'checkmate'
              ? 'Checkmate'
              : 'Win on time'
          );
        }
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

  function Board({ fen }) {
    const matrix = fen === 'start'
      ? fenToMatrix('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')
      : fenToMatrix(fen);

    const myPid = playerIdRef.current;
    const myColor = state && state.colors ? state.colors[myPid] : null;

    console.log('Board render:', { myPid, myColor, colors: state?.colors, phase: state?.phase });
    const isMyTurnLocal = state && state.clocks && myColor && state.clocks.turn === myColor;

    const orientation = myColor || (state?.phase === 'PLAYING' ? 'white' : 'white');
    console.log('Board orientation:', orientation, 'myColor:', myColor, 'phase:', state?.phase);

    // compute legal targets for the currently selected square only for player whose turn
    let legalTargets = new Set();
    try {
      if (isMyTurnLocal && selected && ChessJS && localGameRef.current) {
        const g = new ChessJS(localGameRef.current.fen());
        const moves = g.moves({ square: selected, verbose: true }) || [];
        for (const m of moves) legalTargets.add(m.to);
      }
    } catch (e) {}

    const squares = [];

    for (let rIdx = 0; rIdx < 8; rIdx++) {
      for (let cIdx = 0; cIdx < 8; cIdx++) {
        const cell = matrix[rIdx][cIdx];

        const displayRow = myColor === 'black' ? 7 - rIdx : rIdx;
        const displayCol = myColor === 'black' ? 7 - cIdx : cIdx;

        const rank = myColor === 'black' ? displayRow + 1 : 8 - displayRow;
        const fileIndex = myColor === 'black' ? 7 - displayCol : displayCol;
        const file = 'abcdefgh'[fileIndex];
        const sq = `${file}${rank}`;

        const isLight = (displayRow + displayCol) % 2 === 0;
        const baseColor = isLight ? '#f0d9b5' : '#b58863';
        const isSelected = selected === sq;
        const isTarget = legalTargets.has(sq);
        const bg = isSelected ? '#ffeb99' : (isTarget ? '#9fe29f' : baseColor);

        squares.push(
          <div
            key={sq}
            onClick={() => {
              if (!isMyTurnLocal) { setMessage('Not your turn'); return; }
              if (!selected) {
                setSelected(sq);
              } else {
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
            style={{
              width: 54,
              height: 54,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: bg,
              cursor: 'pointer',
              fontSize: 28,
              boxSizing: 'border-box',
              border: isSelected ? '2px solid #f39c12' : '1px solid rgba(0,0,0,0.15)'
            }}
          >
            {cell ? (
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/from', sq);
                  try { e.dataTransfer.setDragImage(e.currentTarget, 16, 16); } catch (e) {}
                }}
                style={{ cursor: 'grab', userSelect: 'none' }}
              >
                <Piece piece={cell} />
              </div>
            ) : ''}
          </div>
        );
      }
    }

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8,54px)',
          gap: 0,
          border: '2px solid #222',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
        }}
      >
        {squares}
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

  if (typeof window === 'undefined') {
      return null;
  }

  if (!roomIdRef.current && !roomId) {
    return <div className="container">Loading room...</div>;
  }

  if (loading || joining || !state) {
    return <div className="container">
      {joining ? 'Joining room...' : (!state ? 'Loading room state...' : 'Loading...')}
    </div>;
  }

  const playerId = playerIdRef.current;
  const amIWinner = state.winnerId && playerId === state.winnerId;
  const myColor = state.colors?.[playerId] ?? null;
  const isMyTurn = state.clocks && myColor && state.clocks.turn === myColor;


  return (
    <main className="container">
      <h2>Room {roomIdRef.current || roomId || '...'}</h2>

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
          <h3>Room State — {state?.phase || 'Loading...'}</h3>

          <div>
            <strong>Players:</strong>
            <ul>
              {state?.players?.map(p => (
                <li key={p.id}>{p.name || p.id}{state?.phase === 'COLOR_PICK' && p.id === state?.winnerId ? ' (bid winner)' : ''}</li>
              )) || <li>Loading players...</li>}
            </ul>
          </div>


          {state?.phase === 'LOBBY' && (
            <div>
              {state?.startRequestedBy ? (
                <div style={{ marginBottom: 8, padding: 8, border: '1px solid #ccc', background: '#fff8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    {state.startRequestedBy === playerIdRef.current ? (
                      <div>You requested bidding — waiting for opponent confirmation</div>
                    ) : (
                      <div>{(state.players.find(p => p.id === state.startRequestedBy)?.name) || state.startRequestedBy} requested bidding — click <strong>Start Bidding</strong> to confirm</div>
                    )}
                    <div style={{ fontSize: '14px', color: '#666', marginTop: 4 }}>
                      Both players return to lobby if no confirmation in:
                    </div>
                  </div>
                  <div>
                    <Countdown 
                      deadline={state.startConfirmDeadline} 
                      totalMs={state.choiceDurationMs} 
                      onExpire={() => setMessage('Returning to lobby')} />
                  </div>
                </div>
              ) : null}
              <button onClick={startBidding} disabled={state?.players?.length < state?.maxPlayers}>
                {state?.startRequestedBy && state.startRequestedBy !== playerIdRef.current ? 'Confirm Start' : 'Start Bidding'}
              </button>
            </div>
          )}

          {state?.phase === 'BIDDING' && (
            <div>
              <p>Bid deadline: {state?.bidDeadline ? <><LiveTimer deadline={state.bidDeadline} format="mm:ss" /> ({new Date(state.bidDeadline).toLocaleTimeString()})</> : '—'}</p>
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
              <p>Winner: {(state?.players?.find(p => p.id === state?.winnerId)?.name) || state?.winnerId || '—'}</p>
              <p>Current picker: {state?.currentPicker || '—'}</p>
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

          {(state?.phase === 'PLAYING' || state?.phase === 'FINISHED') && (
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

              {state?.phase === 'FINISHED' && (
                <div style={{ marginTop: 12, padding: 8, border: '1px solid #ddd', background: '#f7fff7' }}>
                    <div style={{ marginBottom: 8 }}>
                      <strong>Result:</strong>{' '}
                      {state.result === 'draw'
                        ? `Draw${state.reason ? ` (${state.reason})` : ''}`
                        : (gameOverInfo
                            ? `${gameOverInfo.winnerName || gameOverInfo.winnerId || gameOverInfo.color} (${gameOverInfo.color || 'winner'}) wins`
                            : (state.winnerId
                                ? (state.players.find(p => p.id === state.winnerId)?.name || state.winnerId) + ' wins'
                                : 'Game finished'))}
                    </div>
                  {state?.rematchWindowEnds ? (
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
export async function getStaticPaths() {
  return {
    paths: [],
    fallback: 'blocking'
  };
}

export async function getStaticProps() {
  return {
    props: {}
  };
}