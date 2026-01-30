import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Chessboard } from 'react-chessboard';
import Head from 'next/head';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

let ChessJS = null;

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

const Board = React.memo(function Board({ fen, colors, moves, phase, playerIdRef, localGameRef, makeMoveUci, setError }) {
  const [lastMove, setLastMove] = useState(null);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);

  // Function to reset selection state
  const resetSelection = useCallback(() => {
    setSelectedSquare(null);
    setLegalMoves([]);
  }, []);

  useEffect(() => {
    const game = localGameRef.current;
    
    if (!game || !colors) return;

    const myColor = colors[playerIdRef.current];
    const isMyTurn = game.turn() === (myColor === 'white' ? 'w' : 'b');

    if (!isMyTurn) {
      setLegalMoves([]);
      setSelectedSquare(null);
    }
  }, [fen, phase, colors]);

  useEffect(() => {
    if (moves?.length > 0) {
      const last = moves[moves.length - 1];
      if (last?.move?.length >= 4) {
        const from = last.move.slice(0, 2);
        const to = last.move.slice(2, 4);
        setLastMove([from, to]);
      }
    }
  }, [moves]);

  const customSquareStyles = useMemo(() => {
    const styles = {};
    
    legalMoves.forEach(sq => {
      styles[sq] = { backgroundColor: 'rgba(40, 167, 69, 0.2)' };
    });

    if (selectedSquare) {
      styles[selectedSquare] = {
        backgroundColor: 'rgba(0, 123, 255, 0.4)',
        border: '2px solid #007bff'
      };
    }

    if (lastMove?.length === 2) {
      styles[lastMove[0]] = { backgroundColor: 'rgba(255,255,0,0.3)' };
      styles[lastMove[1]] = { backgroundColor: 'rgba(255,255,0,0.3)' };
    }

    return styles;
  }, [legalMoves, selectedSquare, lastMove]);

  function playMoveSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  }

  async function onSquareClick(square) {
    const playerColor = colors?.[playerIdRef.current] ?? null;

    const game = localGameRef.current;
    if (!game) {
      return;
    }

    const turnLetter = game.turn() === 'w' ? 'white' : 'black';

    if (turnLetter !== playerColor) {
      return;
    }

    const piece = game.get(square);

    if (selectedSquare === square) {
      setSelectedSquare(null);
      setLegalMoves([]);
      return;
    }

    if (selectedSquare && legalMoves.includes(square)) {
      const from = selectedSquare;
      const to = square;
      const pieceOnFrom = game.get(from);
      const isPawn = pieceOnFrom && pieceOnFrom.type === 'p';
      const targetRank = Number(to[1]);
      const needsPromotion = isPawn && (targetRank === 8 || targetRank === 1);

      if (needsPromotion) {
        setPendingPromotion({ source: from, target: to });
        setShowPromotionModal(true);
        setSelectedSquare(null);
        setLegalMoves([]);
        return;
      }

      try {
        const success = await makeMoveUci(from + to, null, resetSelection);
        if (success) {
          playMoveSound();
          resetSelection();
        }
      } catch (err) {
        console.error('Move failed:', err);
      }
      return;
    }

    if (piece && 
        ((piece.color === 'w' && playerColor === 'white') || 
         (piece.color === 'b' && playerColor === 'black'))) {
      
      const moves = game.moves({ square, verbose: true }) || [];
      const moveTargets = moves.map(m => m.to);
      
      setSelectedSquare(square);
      setLegalMoves(moveTargets);
    } else {
      setSelectedSquare(null);
      setLegalMoves([]);
    }
  }

  function onDrop(sourceSquare, targetSquare) {
    const playerColor = colors?.[playerIdRef.current] ?? null;
    if (!playerColor) return false;

    const game = localGameRef.current;
    if (!game) return false;

    const turnLetter = game.turn() === 'w' ? 'white' : 'black';
    if (turnLetter !== playerColor) return false;

    const piece = game.get(sourceSquare);
    if (!piece) return false;

    const isPawn = piece.type === 'p';
    const targetRank = Number(targetSquare[1]);
    const needsPromotion = isPawn && (targetRank === 8 || targetRank === 1);

    if (needsPromotion) {
      setPendingPromotion({ source: sourceSquare, target: targetSquare });
      setShowPromotionModal(true);
      return false;
    }

    makeMoveUci(sourceSquare + targetSquare, null, resetSelection).then(success => {
      if (success) {
        playMoveSound();
        resetSelection();
      }
    }).catch(() => {
    });

    return true;
  }

  function handlePromotion(promotionPiece) {
    if (!pendingPromotion) return;
    const { source, target } = pendingPromotion;
    makeMoveUci(source + target + promotionPiece, null, resetSelection).then(success => {
      if (success) {
        setShowPromotionModal(false);
        setPendingPromotion(null);
        playMoveSound();
        resetSelection();
      }
    }).catch(() => {
    });
  }

  return (
    <>
      {/* Manual chessboard with professional styling */}
      <div style={{ 
        backgroundColor: '#000000',
        padding: '0px',
        display: 'inline-block'
      }}>
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 50px)',
          gridTemplateRows: 'repeat(8, 50px)',
          gap: '0px',
          backgroundColor: '#000000',
          padding: '0px',
          width: '400px',
          height: '400px',
          borderRadius: '4px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          border: '1px solid #000000'
        }}>
          {[
            'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
            'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
            'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
            'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
            'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
            'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
            'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
            'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'
          ].map((square) => {
            const game = localGameRef.current;
            const piece = game ? game.get(square) : null;
            const isLight = (square.charCodeAt(0) - 'a'.charCodeAt(0) + parseInt(square[1])) % 2 === 0;
            
            let bgColor = isLight ? '#f0d9b5' : '#b58863';
            let borderStyle = 'none';
            
            if (selectedSquare === square) {
              borderStyle = '2px solid #007bff';
            } else if (legalMoves.includes(square)) {
              borderStyle = '2px solid #dc3545';
            }
            
            return (
              <div
                key={square}
                draggable={!!piece}
                onClick={() => onSquareClick(square)}
                onDragStart={(e) => {
                  const piece = game ? game.get(square) : null;
                  if (!piece) return;
                  e.dataTransfer.setData('text/plain', square);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const sourceSquare = e.dataTransfer.getData('text/plain');
                  const targetSquare = square;
                  
                  if (sourceSquare && targetSquare && sourceSquare !== targetSquare) {
                    const game = localGameRef.current;
                    const playerColor = colors?.[playerIdRef.current] ?? null;
                    
                    if (!playerColor || !game) return false;

                    const turnLetter = game.turn() === 'w' ? 'white' : 'black';
                    if (turnLetter !== playerColor) return false;

                    const piece = game.get(sourceSquare);
                    if (!piece) return false;

                    // Check if move is legal before proceeding
                    const moves = game.moves({ square: sourceSquare, verbose: true }) || [];
                    const legalTargets = moves.map(m => m.to);
                    if (!legalTargets.includes(targetSquare)) {
                      // Show error for illegal drag move
                      setError('Illegal move - try again');
                      setTimeout(() => setError(null), 3000);
                      return false;
                    }

                    const isPawn = piece.type === 'p';
                    const targetRank = Number(targetSquare[1]);
                    const needsPromotion = isPawn && (targetRank === 8 || targetRank === 1);

                    if (needsPromotion) {
                      setPendingPromotion({ source: sourceSquare, target: targetSquare });
                      setShowPromotionModal(true);
                      setSelectedSquare(null);
                      setLegalMoves([]);
                      return false;
                    }

                    try {
                      const success = await makeMoveUci(sourceSquare + targetSquare, null, resetSelection);
                      if (success) {
                        playMoveSound();
                        resetSelection();
                      }
                    } catch (err) {
                      console.error('Drag move failed:', err);
                      // Error is already handled in makeMoveUci, no need to duplicate
                    }
                  }
                  return true;
                }}
                style={{
                  backgroundColor: bgColor,
                  border: borderStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: piece ? 'grab' : 'pointer',
                  fontSize: '36px',
                  fontFamily: 'Arial Unicode MS, sans-serif',
                  fontWeight: 'normal',
                  userSelect: 'none',
                  position: 'relative'
                }}
              >
                {piece ? (
                  <span style={{
                    fontSize: '32px',
                    lineHeight: '1',
                    color: piece.color === 'w' ? '#ffffff' : '#000000',
                    textShadow: piece.color === 'w' ? '0 0 1px rgba(0,0,0,0.8)' : '0 0 1px rgba(255,255,255,0.8)'
                  }}>
                    {piece.color === 'w' ? 
                      (piece.type === 'p' ? '♟' : piece.type === 'r' ? '♖' : piece.type === 'n' ? '♘' : piece.type === 'b' ? '♗' : piece.type === 'q' ? '♕' : '♔') :
                      (piece.type === 'p' ? '♙' : piece.type === 'r' ? '♜' : piece.type === 'n' ? '♞' : piece.type === 'b' ? '♝' : piece.type === 'q' ? '♛' : '♚')
                    }
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {showPromotionModal && pendingPromotion && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            background: 'white', padding: '24px', borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', textAlign: 'center'
          }}>
            <h3 style={{ margin: '0 0 16px' }}>Promote pawn to:</h3>
            <div style={{ display: 'flex', gap: '16px' }}>
              {['q', 'r', 'b', 'n'].map(piece => {
                const game = localGameRef.current;
                const isWhiteTurn = game?.turn() === 'w';
                const pieceSymbol = piece === 'q' ? (isWhiteTurn ? '♕' : '♛') : 
                                   piece === 'r' ? (isWhiteTurn ? '♖' : '♜') : 
                                   piece === 'b' ? (isWhiteTurn ? '♗' : '♝') : 
                                   (isWhiteTurn ? '♘' : '♞');
                return (
                  <button
                    key={piece}
                    onClick={() => handlePromotion(piece)}
                    style={{
                      fontSize: '40px', padding: '12px 24px',
                      background: '#f8f9fa', border: '1px solid #ccc',
                      borderRadius: '8px', cursor: 'pointer', minWidth: '80px'
                    }}
                  >
                    {pieceSymbol}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

const MemoizedBoard = React.memo(function MemoizedBoard({ fen, colors, moves, phase, playerIdRef, localGameRef, makeMoveUci, setError }) {
  return (
    <Board 
      fen={fen}
      colors={colors}
      moves={moves}
      phase={phase}
      playerIdRef={playerIdRef}
      localGameRef={localGameRef}
      makeMoveUci={makeMoveUci}
      setError={setError}
    />
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.fen === nextProps.fen &&
    prevProps.phase === nextProps.phase &&
    JSON.stringify(prevProps.colors) === JSON.stringify(nextProps.colors) &&
    JSON.stringify(prevProps.moves) === JSON.stringify(nextProps.moves)
  );
});

export default function Room() {
  const router = useRouter();
  
  const getRoomId = () => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const match = path.match(/^\/room\/(.+)$/);
      return match ? match[1] : null;
    }
    return null;
  };

  const roomId = getRoomId() || router.query.id;

  const [state, setState] = useState(null);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNameInput, setShowNameInput] = useState(false);
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
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const playerIdRef = useRef(null);
  const wsRef = useRef(null);
  const shortPollRef = useRef(null);
  const shortPollTimeoutRef = useRef(null);
  const timeForfeitSentRef = useRef(false);
  const rejoinAttemptedRef = useRef(false);
  const roomIdRef = useRef(null);
  const [startPending, setStartPending] = useState(false);

  const boardFenProp = useMemo(() => boardFen === 'start' ? 'start' : boardFen, [boardFen]);

  const showToast = (message, type = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
  };

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

    fetchState();

    const savedName = localStorage.getItem('playerName') || getCookie('playerName');
    const savedPlayerId = localStorage.getItem('playerId') || getCookie('playerId');

    if (savedName && savedPlayerId) {
      setName(savedName);
      playerIdRef.current = savedPlayerId;
      setLoading(true);
      fetchState().then(() => {
        const isInRoom = state?.players?.some(p => p.id === savedPlayerId);
        if (isInRoom) {
          setJoined(true);
          setLoading(false);
          setupWebSocket();
        } else {
          autoJoin(savedPlayerId, savedName);
        }
      }).catch((error) => {
        autoJoin(savedPlayerId, savedName);
      });
    } else {
      setShowNameInput(true);
      setLoading(false);
    }
  }, []);

  const getBackendRoomId = () => {
    const rid = roomIdRef.current || roomId || '';
    const result = rid.startsWith('room-') ? rid : (rid ? 'room-' + rid : null);
        return result;
  };

  function handleNameSubmit(playerName) {
    if (!playerName.trim()) {
      showToast('Please enter your name', 'warning');
      return;
    }
    
    const playerId = crypto.randomUUID();
    localStorage.setItem('playerId', playerId);
    localStorage.setItem('playerName', playerName.trim());
    setCookie('playerId', playerId, 24 * 7);
    setCookie('playerName', playerName.trim(), 24 * 7);
    
    setName(playerName.trim());
    playerIdRef.current = playerId;
    setShowNameInput(false);
    setLoading(true);
    
    autoJoin(playerId, playerName.trim());
  }

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
    }).catch((e) => {
      console.error('Failed to load chess engine', e);
      setError('Failed to load chess engine');
    });
  }, []);

  useEffect(() => {
    if (ChessJS && !localGameRef.current) {
      localGameRef.current = new ChessJS();
      setBoardFen('start');
    }
  }, [ChessJS]);

  async function autoJoin(playerId, playerName) {
    const backendId = getBackendRoomId();
        
    if (!backendId) { 
      setError('Invalid room ID');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${BASE}/rooms/${backendId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        
        if (res.status === 400 && (err.error === 'room_full' || err.error === 'not_in_lobby')) {
          showToast('This room is already full or the game has started. You will be redirected to the lobby.', 'error');
          setTimeout(() => {
            router.push('/');
          }, 2000);
          return;
        }
        
        setError('Failed to join: ' + (err.error || res.status));
        setLoading(false); 
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!data.room) {
        setError('No room returned from server');
        setLoading(false);
        return;
      }
      setJoined(true);
      setLoading(false); 
      setupWebSocket();
      await fetchState();
    } catch (e) {
      setError('Network error joining room');
      setLoading(false); 
    } finally {
      setJoining(false);
    }
  }

  function setupWebSocket() {
    const backendId = getBackendRoomId();
    if (!backendId || !playerIdRef.current) return;

    const wsUrl = `${BASE.replace(/^http/, 'ws')}/rooms/${backendId}/ws?playerId=${playerIdRef.current}`;

    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      const heartbeat = setInterval(async () => {
        try {
          await fetch(`${BASE}/rooms/${getBackendRoomId()}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: playerIdRef.current })
          });
        } catch (e) {
        }
      }, 5000);
      wsRef.current.heartbeatInterval = heartbeat;
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
      }
    };

    wsRef.current.onclose = (event) => {
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

    const last = room.clocks?.lastTickAt || now;
    const elapsed = Math.max(0, now - last);
    const whiteMs = (room.clocks?.whiteRemainingMs || 0) - ((room.clocks?.turn === 'white') ? elapsed : 0);
    const blackMs = (room.clocks?.blackRemainingMs || 0) - ((room.clocks?.turn === 'black') ? elapsed : 0);
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

  async function fetchState() {
    const backendId = getBackendRoomId();
        if (!backendId) {
            return;
    }

    try {
            const res = await fetch(`${BASE}/rooms/${backendId}`);
            
      if (!res.ok) {
        if (res.status === 404) {
          setMessage('Room no longer exists — sending you back to lobby');
          setTimeout(() => router.replace('/'), 3000);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
            const room = data.room || data;

      if (!room) {
        setError('Room not found');
        return;
      }
      
      const savedPlayerId = localStorage.getItem('playerId') || getCookie('playerId');
      const isInRoom = savedPlayerId && room.players?.some(p => p.id === savedPlayerId);
      
      if (room.players?.length >= room.maxPlayers && !isInRoom) {
        showToast('This room is already full. You will be redirected to the lobby.', 'error');
        setTimeout(() => {
          router.push('/');
        }, 2000);
        return;
      }
      
            updateLocalGameAndClocks(room);
      setState(room);

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
            setMessage('Game over');
          }
        } else {
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
        setError('Background rejoin attempt failed');
      }
    } catch (e) {
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
    } catch (e) {
    }
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
        if (data.error === 'already_voted') {
          setError('You have already voted - votes cannot be changed');
          return;
        }
        setError('Failed to send rematch vote');
        return;
      }
      
      if (data.rematchStarted) {
        setMessage('Rematch started!');
        await fetchState();
      } else if (data.voteResult === 'no_vote') {
        // Check if this player voted yes - if so, redirect to queue
        const playerVote = data.votes?.[playerIdRef.current];
        if (playerVote === true) {
          // Yes voter goes to queue
          setMessage('Opponent declined rematch - you\'re back in queue');
          setTimeout(() => {
            router.replace('/');
          }, 2000);
        } else {
          // No voter goes to lobby
          setMessage('You voted No - returning to lobby');
          setTimeout(() => {
            router.replace('/');
          }, 2000);
        }
      } else if (data.voteResult === 'waiting_for_opponent') {
        setMessage('You voted Yes - waiting for opponent or will join quick match if they decline');
        await fetchState();
      } else {
        setMessage('Vote recorded');
        await fetchState();
      }
    } catch (e) { 
      setError('Network error'); 
    }
  }

  useEffect(() => {
    if (!roomId || !joined) return;

    const isLocalDev = typeof window !== 'undefined' && window.location.hostname === 'localhost';
    
    if (isLocalDev || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            fetchState();
      const interval = setInterval(fetchState, 2000);
      return () => clearInterval(interval);
    } else {
          }
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

      if (state?.phase === 'PLAYING' && !gameOverInfo) {
        if (safeWhite <= 0 && (!state?.winnerId)) {
          const winner = state?.players?.find(p => state?.colors?.[p.id] === 'black');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'black' });
          if (!timeForfeitSentRef.current) {
            timeForfeitSentRef.current = true;
            sendTimeForfeit(state.players.find(p => state.colors && state.colors[p.id] === 'white')?.id || null);
          }
        } else if (safeBlack <= 0 && (!state?.winnerId)) {
          const winner = state?.players?.find(p => state?.colors?.[p.id] === 'white');
          setGameOverInfo({ winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, color: 'white' });
          if (!timeForfeitSentRef.current) {
            timeForfeitSentRef.current = true;
            sendTimeForfeit(state.players.find(p => state.colors && state.colors[p.id] === 'black')?.id || null);
          }
        }
      }
    }, 2000);
    return () => clearInterval(t);
  }, [state, gameOverInfo, timeForfeitSentRef, sendTimeForfeit]);

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
        setError('Bid failed: ' + (err.error || 'Unknown error'));
        setTimeout(() => setError(null), 5000); // Auto-clear error after 5 seconds
        return;
      }

      setMessage('Bid submitted!');
      setTimeout(() => setMessage(null), 3000); // Auto-clear success after 3 seconds
      await fetchState();
    } catch (e) {
      setMessage('Network error submitting bid');
      setTimeout(() => setMessage(null), 5000); // Auto-clear after 5 seconds
    }
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

  const makeMoveUci = useCallback(async function(uci, promotion, resetSelection) {
    const playerId = playerIdRef.current;
    if (!playerId) { setError('Missing player id'); return false; }
    if (!ChessJS) { setError('Chess engine not loaded'); return false; }
    const game = localGameRef.current || new ChessJS();
    const from = uci.slice(0,2);
    const to = uci.slice(2,4);
    const promotionPiece = promotion || (uci.length >= 5 ? uci[4] : undefined);

    const playerColor = state?.colors?.[playerId] ?? null;
    if (!playerColor) { setError('Unknown player color'); return false; }
    const turnLetter = game.turn() === 'w' ? 'white' : 'black';
    if (turnLetter !== playerColor) { setError('Not your turn'); return false; }
    const test = new ChessJS(game.fen());

    const maybePiece = test.get(from);
    const isPawn = maybePiece && maybePiece.type === 'p';
    const targetRank = Number(to[1]);
    const needsPromotion = isPawn && (targetRank === 8 || targetRank === 1);

    if (needsPromotion && uci.length === 4) {
      setPromotionPending({ from, to, uciBase: `${from}${to}` });
      return false;
    }

    let moved;
    try {
      moved = test.move({ from, to, promotion: promotionPiece });
    } catch (e) {
      console.error('Chess engine rejected move:', e);
      // Show user-friendly error for illegal moves
      setError('Illegal move - try again');
      setTimeout(() => setError(null), 3000); // Clear error after 3 seconds
      // Reset board selection state
      if (resetSelection) resetSelection();
      return false;
    }
    if (!moved) {
      // Show user-friendly error for illegal moves
      setError('Illegal move - try again');
      setTimeout(() => setError(null), 3000); // Clear error after 3 seconds
      // Reset board selection state
      if (resetSelection) resetSelection();
      return false;
    }

    try {
      game.move({ from, to, promotion: promotionPiece });
    } catch (e) {
      console.error('Failed to apply move to local game:', e);
      return false;
    }
    localGameRef.current = game;
    setBoardFen(game.fen());
    setPgn(game.pgn());

    const isGameOver = (typeof game.isGameOver === 'function' && game.isGameOver()) || (typeof game.isCheckmate === 'function' && game.isCheckmate());
    if (isGameOver) {
      const turnAfter = game.turn();
      const winnerColor = turnAfter === 'w' ? 'black' : 'white';
      const winnerId = state?.colors ? Object.keys(state.colors).find(id => state.colors[id] === winnerColor) : null;
      const winnerName = state?.players ? (state.players.find(p => p.id === winnerId)?.name || null) : null;
      setGameOverInfo({ winnerId, winnerName, color: winnerColor });
    }

    const backendId = getBackendRoomId();
    try {
      const moveUci = promotionPiece ? `${from}${to}${promotionPiece}` : `${from}${to}`;
      const res = await fetch(`${BASE}/rooms/${backendId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, move: moveUci }),
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
          const winner = state?.players?.find(p => p.id === winnerId);
          const color = state?.colors?.[winnerId] ?? null;
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
  }, [state]);

  function formatMs(ms) {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    return `${mins}m ${secs % 60}s`;
  }

  if (loading || joining || !state) {
        return (
      <div className="container">
        {joining ? 'Joining room...' : (!state ? 'Loading room state...' : 'Loading...')}
      </div>
    );
  }

  if (showNameInput) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          background: 'white',
          padding: '32px',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          maxWidth: '400px',
          width: '90%'
        }}>
          <h2 style={{ marginBottom: '16px', textAlign: 'center' }}>Enter Your Name</h2>
          <input
            type="text"
            placeholder="Your name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleNameSubmit(e.target.value);
              }
            }}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              marginBottom: '16px',
              boxSizing: 'border-box'
            }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => {
                const input = document.querySelector('input[placeholder="Your name"]');
                if (input) handleNameSubmit(input.value);
              }}
              style={{
                flex: 1,
                padding: '12px 24px',
                fontSize: '16px',
                background: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Join Room
            </button>
            <button
              onClick={() => router.push('/')}
              style={{
                flex: 1,
                padding: '12px 24px',
                fontSize: '16px',
                background: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const playerId = playerIdRef.current;
  const amIWinner = state?.winnerId && playerId === state.winnerId;
  const myColor = state.colors?.[playerId] ?? null;
  const isMyTurn = state.clocks && myColor && state.clocks.turn === myColor;

  return (
    <>
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Chess:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      {toast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 20px',
          borderRadius: '8px',
          color: 'white',
          fontWeight: '500',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          background: toast.type === 'success' ? '#28a745' : 
                     toast.type === 'error' ? '#dc3545' : 
                     toast.type === 'warning' ? '#ffc107' : '#17a2b8',
          animation: 'slideIn 0.3s ease-out'
        }}>
          {toast.message}
        </div>
      )}
      <main className="container" style={{ backgroundColor: 'transparent' }}>
      <h2>Room {roomIdRef.current || roomId || '...'}</h2>

      {(state?.private || (typeof window !== 'undefined' && window.location.search.includes('private=true'))) && (
        <div className="share">
          <input readOnly value={typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''} />
          <button onClick={copyLink}>Copy Link</button>
        </div>
      )}

      {message && (
        <div style={{ 
          color: message.includes('failed') || message.includes('error') ? 'red' : 'green', 
          marginTop: 8 
        }}>
          {message}
        </div>
      )}
      {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}

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
              <div>startRequestedBy: {String(state?.startRequestedBy || 'null')}</div>
              <div>startConfirmDeadline: {state?.startConfirmDeadline ? new Date(state.startConfirmDeadline).toLocaleString() : 'null'}</div>
              <div>choiceDurationMs: {String(state?.choiceDurationMs || 'null')}</div>
              <div>closed: {String(!!state?.closed)}</div>
              <div>
                remainingMs: {state?.startConfirmDeadline ? Math.max(0, state.startConfirmDeadline - Date.now()) : '—'}
                {state?.startConfirmDeadline && state?.choiceDurationMs ? (' — pct: ' + Math.round(Math.max(0, Math.min(100, ((Math.max(0, state.startConfirmDeadline - Date.now()) / state.choiceDurationMs) * 100))))) + '%' : ''}
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
                    {state?.startRequestedBy === playerIdRef.current ? (
                      <div>You requested bidding — waiting for opponent confirmation</div>
                    ) : (
                      <div>{(state?.players?.find(p => p.id === state?.startRequestedBy)?.name) || state?.startRequestedBy} requested bidding — click <strong>Start Bidding</strong> to confirm</div>
                    )}
                    <div style={{ fontSize: '14px', color: '#666', marginTop: 4 }}>
                      Both players return to lobby if no confirmation in:
                    </div>
                  </div>
                  <div>
                    <Countdown 
                      deadline={state?.startConfirmDeadline} 
                      totalMs={state?.choiceDurationMs} 
                      onExpire={() => setMessage('Returning to lobby')} />
                  </div>
                </div>
              ) : null}
              <button onClick={startBidding} disabled={state?.players?.length < state?.maxPlayers}>
                {state?.startRequestedBy && state?.startRequestedBy !== playerIdRef.current ? 'Confirm Start' : 'Start Bidding'}
              </button>
            </div>
          )}

          {state?.phase === 'BIDDING' && (
            <div>
              <p>Bid deadline: {state?.bidDeadline ? <><LiveTimer deadline={state.bidDeadline} format="mm:ss" /> ({new Date(state.bidDeadline).toLocaleTimeString()})</> : '—'}</p>
              <p>Existing bids:</p>
              <ul>
                {state?.players?.map(p => {
                  const hasBid = state?.bids && state?.bids[p.id];
                  if (state?.phase === 'BIDDING') {
                    return <li key={p.id}>{p.name || p.id}: {hasBid ? 'Submitted' : (p.id === playerId ? 'You — not submitted' : '—')}</li>;
                  }
                  const amt = hasBid && typeof state?.bids?.[p.id]?.amount === 'number' ? state?.bids[p.id].amount : null;
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

          {state?.phase === 'COLOR_PICK' && (
            <div>
              <p>Winner: {(state?.players?.find(p => p.id === state?.winnerId)?.name) || state?.winnerId || '—'}</p>
              <p>Current picker: {state?.currentPicker || '—'}</p>
              {(() => {
                const canChoose = (state?.currentPicker === 'winner' && playerId === state?.winnerId) || (state?.currentPicker === 'loser' && playerId === state?.loserId);
                if (canChoose) {
                  return (
                    <div>
                      <p>Choose color (black receives draw odds):</p>
                      <button onClick={() => chooseColor('white')}>White</button>
                      <button onClick={() => chooseColor('black')}>Black</button>
                      <p>Time remaining to choose: {state?.choiceDeadline ? <LiveTimer deadline={state.choiceDeadline} /> : '—'}</p>
                    </div>
                  );
                }
                return <p>Waiting for {state?.currentPicker} to choose a color...</p>;
              })()}
            </div>
          )}

          {(state?.phase === 'PLAYING' || state?.phase === 'FINISHED') && (
            <div>
              <div style={{ 
                textAlign: 'center',
                fontSize: 20, 
                fontWeight: 'bold', 
                marginBottom: 12,
                color: state.clocks?.turn === 'white' ? '#f0d9b5' : '#b58863',
                textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
              }}>
                Turn: {state.clocks ? state.clocks.turn.toUpperCase() : '—'}
              </div>

              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ 
                  width: 440, 
                  padding: '8px', 
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}>
                  <MemoizedBoard 
                    fen={boardFenProp}
                    colors={state?.colors}
                    moves={state?.moves}
                    phase={state?.phase}
                    playerIdRef={playerIdRef}
                    localGameRef={localGameRef}
                    makeMoveUci={makeMoveUci}
                    setError={setError}
                  />
                </div>
              </div>

              <div style={{ 
                display: 'flex', 
                gap: 24, 
                marginTop: 16,
                justifyContent: 'center'
              }}>
                <div style={{
                  fontWeight: 'bold',
                  color: '#fff',
                  background: '#b58863',
                  padding: '8px 16px',
                  borderRadius: 6,
                  minWidth: 100,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}>
                  White: {liveWhiteMs !== null ? Math.ceil(liveWhiteMs/1000) + 's' : (state.clocks ? Math.max(0, Math.floor((state.clocks.whiteRemainingMs || 0) / 1000)) + 's' : '—')}
                </div>
                <div style={{
                  fontWeight: 'bold',
                  color: '#000',
                  background: '#f0d9b5',
                  padding: '8px 16px',
                  borderRadius: 6,
                  minWidth: 100,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}>
                  Black: {liveBlackMs !== null ? Math.ceil(liveBlackMs/1000) + 's' : (state.clocks ? Math.max(0, Math.floor((state.clocks.blackRemainingMs || 0) / 1000)) + 's' : '—')}
                </div>
              </div>

              {state?.phase === 'FINISHED' && (
                <div style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', background: '#f7fff7', borderRadius: 8 }}>
                  <div style={{ marginBottom: 16 }}>
                    <strong>Result:</strong>{' '}
                    {state?.result === 'draw'
                      ? `Draw${state?.reason ? ` (${state.reason})` : ''}`
                      : (gameOverInfo
                          ? `${gameOverInfo.winnerName || gameOverInfo.winnerId || gameOverInfo.color} (${gameOverInfo.color || 'winner'}) wins`
                          : (state?.winnerId
                              ? (state?.players?.find(p => p.id === state.winnerId)?.name || state.winnerId) + ' wins'
                              : 'Game finished'))}
                  </div>
                  {state?.rematchWindowEnds ? (
                    <div>
                      <div style={{ marginBottom: 8 }}>Rematch voting open — ends in <em><LiveTimer deadline={state.rematchWindowEnds} /></em></div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => sendRematchVote(true)} disabled={state?.rematchVotes && state.rematchVotes[playerIdRef.current] === true}>Vote Yes</button>
                        <button onClick={() => sendRematchVote(false)} disabled={state?.rematchVotes && state.rematchVotes[playerIdRef.current] === false}>Vote No</button>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        Votes: {state?.players?.map(p => `${p.name || p.id}: ${state?.rematchVotes && typeof state.rematchVotes[p.id] !== 'undefined' ? (state.rematchVotes[p.id] ? 'Yes' : 'No') : '—'}`).join(' | ')}
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
    </>
  );
}
