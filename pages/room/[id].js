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

  const roomIdRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !queryId) return;

    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    const pathId = parts[1];

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
  }, [queryId]);

  async function autoJoin(playerId, playerName) {
    const roomId = roomIdRef.current;
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
    const roomId = roomIdRef.current;
    if (!roomId || !playerIdRef.current) return;

    const wsUrl = `${BASE.replace(/^http/, 'ws')}/rooms/${roomId}/ws?playerId=${playerIdRef.current}`;
    console.log('Connecting WS to:', wsUrl);

    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected to room:', roomId);
      fetchState(); // Force immediate state refresh when WS connects
    };

    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WS received:', data.type, 'Players:', data.room?.players?.length || 'unknown');
        if (data.type === 'init' || data.type === 'update') {
          const room = data.room;
          if (!room || !room.roomId || room.roomId !== roomId) {
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
      const whiteMs = (room.clocks.whiteRemainingMs || 0) - ((room.clocks.turn === 'white') ? (now - last) : 0);
      const blackMs = (room.clocks.blackRemainingMs || 0) - ((room.clocks.turn === 'black') ? (now - last) : 0);
      setLiveWhiteMs(Math.max(0, whiteMs));
      setLiveBlackMs(Math.max(0, blackMs));
    }
  }

  async function fetchState() {
    const roomId = roomIdRef.current;
    if (!roomId) return;

    try {
      const res = await fetch(`${BASE}/rooms/${roomId}`);
      if (!res.ok) throw new Error('Failed to fetch state');
      const data = await res.json();
      const room = data.room || data;
      console.log('Fetched state - Players:', room.players?.length || 0);
      if (!room || !room.roomId || room.roomId !== roomId) {
        setError('Room not found');
        return;
      }
      updateLocalGameAndClocks(room);
      setState(room);
    } catch (e) {
      console.error('Fetch error:', e);
      setError('Failed to load room state');
    }
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
      const whiteMs = (state.clocks.whiteRemainingMs || 0) - ((state.clocks.turn === 'white') ? (now - last) : 0);
      const blackMs = (state.clocks.blackRemainingMs || 0) - ((state.clocks.turn === 'black') ? (now - last) : 0);
      setLiveWhiteMs(Math.max(0, Math.floor(whiteMs)));
      setLiveBlackMs(Math.max(0, Math.floor(blackMs)));
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
    const roomId = roomIdRef.current;
    try {
      const res = await fetch(`${BASE}/rooms/${roomId}/start-bidding`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError('Failed to start bidding: ' + (err.error || res.status));
        return;
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
    const roomId = roomIdRef.current;
    try {
      const res = await fetch(`${BASE}/rooms/${roomId}/submit-bid`, {
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
    const roomId = roomIdRef.current;
    try {
      const res = await fetch(`${BASE}/rooms/${roomId}/choose-color`, {
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

    const moved = test.move({ from, to, promotion: promotion || 'q' });
    if (!moved) return setError('Illegal move');

    game.move({ from, to, promotion: promotion || 'q' });
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

    const roomId = roomIdRef.current;
    try {
      const res = await fetch(`${BASE}/rooms/${roomId}/move`, {
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
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,44px)', gap: 0, border: '1px solid #333' }}>
        {matrix.flatMap((row, rIdx) => row.map((cell, cIdx) => {
          const rank = 8 - rIdx;
          const file = 'abcdefgh'[cIdx];
          const sq = `${file}${rank}`;
          const isLight = (rIdx + cIdx) % 2 === 0;
          return (
            <div key={sq}
              onClick={() => {
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
              style={{ width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center', background: isLight ? '#f0d9b5' : '#b58863', cursor: 'pointer', fontSize: 24 }}>
              {cell ? (
                <span draggable onDragStart={(e) => e.dataTransfer.setData('text/from', sq)}>{pieceMap[cell]}</span>
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
            <strong style={{ fontSize: 18 }}>{gameOverInfo.winnerName || gameOverInfo.winnerId} ({gameOverInfo.color}) wins</strong>
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
              <button onClick={startBidding} disabled={state.players.length < state.maxPlayers}>Start Bidding</button>
            </div>
          )}

          {state.phase === 'BIDDING' && (
            <div>
              <p>Bid deadline: {state.bidDeadline ? new Date(state.bidDeadline).toLocaleTimeString() : '—'}</p>
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
              <p>Winner: {state.winnerId}</p>
              <p>Current picker: {state.currentPicker}</p>
              {(() => {
                const canChoose = (state.currentPicker === 'winner' && playerId === state.winnerId) || (state.currentPicker === 'loser' && playerId === state.loserId);
                if (canChoose) {
                  return (
                    <div>
                      <p>Choose color (black receives draw odds):</p>
                      <button onClick={() => chooseColor('white')}>White</button>
                      <button onClick={() => chooseColor('black')}>Black</button>
                      <p>Time remaining to choose: {state.choiceDeadline ? Math.max(0, Math.ceil((state.choiceDeadline - Date.now())/1000)) + 's' : '—'}</p>
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
            </div>
          )}
        </section>
      )}
    </main>
  );
}