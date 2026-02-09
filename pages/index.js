import { useRouter } from 'next/router';
import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const TIME_CONTROLS = [
  { minutes: 5, ms: 300000, display: '5 min' },
  { minutes: 10, ms: 600000, display: '10 min' },
  { minutes: 15, ms: 900000, display: '15 min' },
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [gameType, setGameType] = useState(null);
  const [autoJoinPending, setAutoJoinPending] = useState(false);
  const [autoJoinCountdown, setAutoJoinCountdown] = useState(0);
  const [queueStatus, setQueueStatus] = useState({});
  const [queueStatusTimestamp, setQueueStatusTimestamp] = useState(0);
  const queueStatusTimestampRef = useRef(0);
  const [isQueued, setIsQueued] = useState(false);
  const isQueuedRef = useRef(false); // Track queue state immediately
  const [queueStartTime, setQueueStartTime] = useState(null);
  const [queueTimeRemaining, setQueueTimeRemaining] = useState(null);
  const [toast, setToast] = useState(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const autoJoinTimerRef = useRef(null);
  const autoJoinIntervalRef = useRef(null);
  const matchCheckIntervalRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  const lobbyWsRef = useRef(null);

  const showToast = (message, type = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
  };

  function getOrCreatePlayerId() {
    if (typeof window === 'undefined') return crypto.randomUUID();
    const existing = window.localStorage.getItem('playerId');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem('playerId', fresh);
    return fresh;
  }

  useEffect(() => {
    const { name: queryName } = router.query;
    if (queryName) setName(decodeURIComponent(queryName));
  }, [router.query]);

  useEffect(() => {
    const playerId = localStorage.getItem('playerId');
    if (!playerId) return;

    const checkExistingQueue = async () => {
      try {
        const res = await fetch(`${BASE}/queue/checkMatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.inQueue) {
            setIsQueued(true);
            setQueueStartTime(Date.now());
            setGameType('public');
            const playerName = localStorage.getItem('playerName');
            if (playerName) setName(playerName);

            // No polling needed - WebSocket will handle everything
            if (matchCheckIntervalRef.current) {
              clearInterval(matchCheckIntervalRef.current);
              matchCheckIntervalRef.current = null;
            }
          }
        }
      } catch (e) {}
    };

    checkExistingQueue();
  }, []);

  useEffect(() => {
    const playerId = localStorage.getItem('playerId');
    if (!playerId || !isQueued) return;

    const setupMatchWebSocket = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const matchmakingRoomId = 'matchmaking-notifications';
      const wsUrl = `${BASE.replace(/^http/, 'ws')}/queue/ws?playerId=${playerId}`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setConnectionAttempts(0);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'matched' && data.roomId) {
            const currentPlayerId = localStorage.getItem('playerId');
            if (data.playerIds && !data.playerIds.includes(currentPlayerId)) {
              return;
            }
            
            if (matchCheckIntervalRef.current) {
              clearInterval(matchCheckIntervalRef.current);
              matchCheckIntervalRef.current = null;
            }
            
            if (wsRef.current) {
              wsRef.current.close();
              wsRef.current = null;
            }
            
            if (lobbyWsRef.current) {
              lobbyWsRef.current.close();
              lobbyWsRef.current = null;
            }
            
            const displayId = data.roomId.replace(/^room-/, '');
            router.push(`/room/${displayId}`);
          }
          
          if (data.type === 'player_joined') {
            setQueueStatus(prev => ({
              ...prev,
              [data.playerId]: { type: 'player_joined', timestamp: Date.now() }
            }));
          }
          
          if (data.type === 'queue_update') {
          }
          
          if (data.type === 'queue_status') {
            setQueueStatus(data.estimates || {});
          }
        } catch (e) {
          console.log('WebSocket message error:', e);
        }
      };

      wsRef.current.onclose = () => {
        if (isQueued) {
          const newAttempts = connectionAttempts + 1;
          setConnectionAttempts(newAttempts);
          
          if (newAttempts >= 3) {
            showToast('Matchmaking server is updating. Please try again in a few minutes.', 'error');
            setIsQueued(false);
            setConnectionAttempts(0);
          } else {
            showToast(`Connection issue (attempt ${newAttempts}/3). Retrying...`, 'warning');
            setTimeout(() => {
              setupMatchWebSocket();
            }, 3000);
          }
        }
      };

      wsRef.current.onerror = (error) => {
        console.log('WebSocket error:', error);
        // Let onclose handle reconnection logic
      };
    };

    setupMatchWebSocket();
    
    // No heartbeat polling - pure WebSocket system

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isQueued]);

  // Fetch queue status for all users viewing public game page
  useEffect(() => {
    if (gameType !== 'public') return;

    const setupLobbyWebSocket = () => {
      if (lobbyWsRef.current) {
        lobbyWsRef.current.close();
      }

      const wsUrl = `${BASE.replace(/^http/, 'ws')}/lobby/ws`;
      lobbyWsRef.current = new WebSocket(wsUrl);

      lobbyWsRef.current.onopen = () => {
      };

      lobbyWsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'queue_status' || data.type === 'queue_update') {
            if (isQueuedRef.current) {
              return;
            }
            
            if (!data.timestamp || data.timestamp > queueStatusTimestampRef.current) {
              setQueueStatus(data.estimates || {});
              setQueueStatusTimestamp(data.timestamp || Date.now());
              queueStatusTimestampRef.current = data.timestamp || Date.now();
            }
          }
        } catch (e) {
          console.log('❌ Lobby WebSocket message error:', e);
        }
      };

      lobbyWsRef.current.onclose = () => {
        setTimeout(() => {
          if (gameType === 'public') {
            setupLobbyWebSocket();
          }
        }, 5000);
      };

      lobbyWsRef.current.onerror = (error) => {
        console.log('Lobby WebSocket error:', error);
      };
    };

    setupLobbyWebSocket();

    return () => {
      if (lobbyWsRef.current) {
        lobbyWsRef.current.close();
      }
    };
  }, [gameType]);

  const refreshQueueStatus = async (showToastMessage = true) => {
    try {
      const res = await fetch(`${BASE}/queue/status`);
      if (res.ok) {
        const data = await res.json();
        const now = Date.now();
        setQueueStatus(data.estimates || {});
        setQueueStatusTimestamp(now);
        queueStatusTimestampRef.current = now;
        if (showToastMessage) {
          showToast('Queue status updated', 'success');
        }
      }
    } catch (e) {
      if (showToastMessage) {
        showToast('Failed to update queue status', 'error');
      }
    }
  };

  const getWaitMessage = (estimateData) => {
    if (!estimateData) return ' • No estimate';

    switch (estimateData.type) {
      case 'match_now':
        return ' • Match NOW!';
      case 'countdown':
        const elapsed = Date.now() - estimateData.startTime;
        const remaining = Math.max(0, estimateData.durationMs - elapsed);
        if (remaining <= 0) return ' • Any moment';
        const minutes = Math.ceil(remaining / 60000);
        return minutes === 1 ? ' • ~1 min' : ` • ~${minutes} min`;
      case 'games_active':
        return ` • ${estimateData.message}`;
      case 'game_active':
        return ' • Game in progress';
      case 'none':
        return ' • No games in place';
      default:
        return ' • No estimate';
    }
  };

  // Queue status and time remaining will be updated via WebSocket messages
  // No polling needed - pure WebSocket system

  const cancelQueue = async () => {
    const playerId = localStorage.getItem('playerId');
    if (!playerId) return;

    if (matchCheckIntervalRef.current) {
      clearInterval(matchCheckIntervalRef.current);
      matchCheckIntervalRef.current = null;
    }

    try {
      await fetch(`${BASE}/queue/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      setIsQueued(false);
      isQueuedRef.current = false; // Reset ref immediately
      setQueueStartTime(null);
      setQueueTimeRemaining(null);

      try {
        const res = await fetch(`${BASE}/queue/status`);
        if (res.ok) {
          const data = await res.json();
          const now = Date.now();
          setQueueStatus(data.estimates || {});
          setQueueStatusTimestamp(now);
          queueStatusTimestampRef.current = now;
        }
      } catch (e) {}

      showToast('You left the queue', 'success');
    } catch (e) {
      showToast('Failed to leave queue', 'error');
    }
  };

  useEffect(() => {
    const playerId = localStorage.getItem('playerId');

    const handleBeforeUnload = () => {
      if (playerId) {
        navigator.sendBeacon(`${BASE}/queue/leave`, JSON.stringify({ playerId }));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (playerId) {
        fetch(`${BASE}/queue/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        }).catch(() => {});
      }
    };
  }, []);

  async function joinPublicQueue(time) {
    if (!name.trim()) {
      showToast('Please enter your name', 'warning');
      return;
    }
    
    setLoading(true);
    
    const playerId = getOrCreatePlayerId();
    const playerName = name.trim();
    
    try {
      const res = await fetch(`${BASE}/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName, mainTimeMs: parseInt(time) * 60 * 1000 }),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        showToast('Failed to join queue: ' + (err.error || res.status), 'error');
        setLoading(false);
        return;
      }
      
      const data = await res.json();
      
      if (data.room && data.room.roomId) {
        localStorage.setItem('playerName', name.trim());
        const displayId = data.room.roomId.replace(/^room-/, '');
        router.push(`/room/${displayId}`);
        return;
      }
      
      if (data.roomId && data.roomId.startsWith('room-')) {
        localStorage.setItem('playerName', name.trim());
        const displayId = data.roomId.replace(/^room-/, '');
        router.push(`/room/${displayId}`);
        return;
      }
      
      if (data.shouldCreateRoom) {
        localStorage.setItem('playerName', name.trim());
        const displayId = data.roomId.replace(/^room-/, '');
        router.push(`/room/${displayId}`);
        return;
      }
      
      if (data.queued) {
        setIsQueued(true);
        isQueuedRef.current = true;
        setQueueStartTime(Date.now());
        showToast(`You're in queue for ${time} minutes. Position: ${data.queuePosition || 1}. You'll be matched automatically!`, 'success');
        setLoading(false);
        
        refreshQueueStatus(false);
        
        if (matchCheckIntervalRef.current) {
          clearInterval(matchCheckIntervalRef.current);
          matchCheckIntervalRef.current = null;
        }
        
        setTimeout(() => {
          if (matchCheckIntervalRef.current) {
            clearInterval(matchCheckIntervalRef.current);
          }
        }, 120000);
      }
    } catch (e) {
      showToast('Network error joining queue', 'error');
      setLoading(false);
    }
  }

  async function joinAllPublicQueues() {
    if (!name.trim()) {
      showToast('Please enter your name', 'warning');
      return;
    }
    
    setLoading(true);
    
    const playerId = getOrCreatePlayerId();
    const playerName = name.trim();
    
    try {
      const res = await fetch(`${BASE}/queue/joinAll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName }),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        showToast('Failed to join queues: ' + (err.error || res.status), 'error');
        setLoading(false);
        return;
      }
      
      const data = await res.json();
      
      if (data.roomId) {
        localStorage.setItem('playerName', name.trim());
        const displayId = data.roomId?.replace(/^room-/, '') || '';
        if (displayId) {
          router.push(`/room/${displayId}`);
          return;
        }
      }
      
      if (data.queued) {
        setIsQueued(true);
        setQueueStartTime(Date.now());
        showToast(`You're in queues for: ${data.joinedQueues.join(', ')} minutes. You'll be matched automatically!`, 'success');
        setLoading(false);
        
        refreshQueueStatus(false);
        
        if (matchCheckIntervalRef.current) {
          clearInterval(matchCheckIntervalRef.current);
        }
        
        matchCheckIntervalRef.current = setInterval(async () => {
          try {
            const matchRes = await fetch(`${BASE}/queue/checkMatch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playerId }),
            });
            
            if (matchRes.ok) {
              const matchData = await matchRes.json();
              
              if (matchData.matched && matchData.roomId) {
                clearInterval(matchCheckIntervalRef.current);
                localStorage.setItem('playerName', name.trim());
                const displayId = matchData.roomId.replace(/^room-/, '');
                router.push(`/room/${displayId}`);
                return;
              }
              
              if (!matchData.inQueue && !matchData.matched) {
                clearInterval(matchCheckIntervalRef.current);
                setIsQueued(false);
                setLoading(false);
                return;
              }
            }
          } catch (e) {
          }
        }, 10000);
        
        setTimeout(() => {
          clearInterval(matchCheckIntervalRef.current);
        }, 120000);
      } else {
        setLoading(false);
        showToast('No available queues found. You can create a private room instead!', 'info');
      }
    } catch (e) {
      showToast('Network error joining queues', 'error');
      setLoading(false);
    }
  }

  async function createPrivateRoom(time) {
    if (!name.trim()) {
      showToast('Please enter your name', 'warning');
      return;
    }
    setLoading(true);
    
    try {
      const playerId = getOrCreatePlayerId();
      const playerName = name.trim();
      
      const res = await fetch(`${BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private: true, mainTimeMs: parseInt(time) * 60 * 1000, creatorName: playerName, creatorPlayerId: playerId }),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        showToast('Failed to create room: ' + (err.error || res.status), 'error');
        return;
      }
      
      const data = await res.json();
      const roomId = data.roomId || data.meta?.roomId;
      if (!roomId) {
        showToast('No room ID returned', 'error');
        return;
      }
      
      localStorage.setItem('playerName', name.trim());
      const displayId = roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}?private=true`);
    } catch (e) {
      showToast('Network error creating room', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function playPublic() {
    if (!name.trim()) {
      showToast('Please enter your name', 'warning');
      return;
    }
    setLoading(true);
    try {
      const playerId = getOrCreatePlayerId();
      const playerName = name.trim();
      const res = await fetch(`${BASE}/rooms/join-next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          localStorage.setItem('playerName', playerName);
          
          const createRes = await fetch(`${BASE}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ private: false, creatorName: playerName, creatorPlayerId: playerId }),
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({ error: 'unknown' }));
            showToast('Failed to create room: ' + (err.error || createRes.status));
            return;
          }
          const data = await createRes.json();
          const roomId = data.roomId || data.meta?.roomId;
          if (!roomId) {
            showToast('No room ID returned');
            return;
          }
          const displayId = roomId.replace(/^room-/, '');
          router.push(`/room/${displayId}`);
          return;
        }
        const err = await res.json().catch(() => ({}));
        showToast('Quick match error: ' + (err.error || res.status));
        return;
      }

      const data = await res.json();
      
      if (data.error) {
        if (data.error === 'no_lobby_rooms') {
          const createRes = await fetch(`${BASE}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ private: false }),
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({ error: 'unknown' }));
            showToast('Failed to create room: ' + (err.error || createRes.status));
            return;
          }
          const createData = await createRes.json();
          const roomId = createData.roomId || createData.meta?.roomId;
          if (!roomId) {
            showToast('No room ID returned');
            return;
          }
          const displayId = roomId.replace(/^room-/, '');
          router.push(`/room/${displayId}`);
          return;
        }
        showToast('Quick match error: ' + data.error);
        return;
      }
      
      const room = data.room || data;
      
      if (room.error) {
        if (room.error === 'room_too_old' || room.error === 'no_lobby_rooms') {
          const createRes = await fetch(`${BASE}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ private: false }),
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({ error: 'unknown' }));
            showToast('Failed to create room: ' + (err.error || createRes.status));
            return;
          }
          const createData = await createRes.json();
          const roomId = createData.roomId || createData.meta?.roomId;
          if (!roomId) {
            showToast('No room ID returned');
            return;
          }
          const displayId = roomId.replace(/^room-/, '');
          router.push(`/room/${displayId}`);
          return;
        }
        showToast('Quick match error: ' + room.error);
        return;
      }
      
      if (!room?.roomId) {
        showToast('No room returned');
        return;
      }
      localStorage.setItem('playerName', name.trim());
      const displayId = room.roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}`);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  }

  async function playPrivate() {
    if (!name.trim()) {
      showToast('Please enter your name');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        showToast('Failed to create room: ' + (err.error || res.status));
        return;
      }
      const data = await res.json();
      const roomId = data.roomId || data.meta?.roomId;
      if (!roomId) {
        showToast('No room ID returned');
        return;
      }
      const playerId = getOrCreatePlayerId();
      localStorage.setItem('playerName', name.trim());
      const displayId = roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}?private=true`);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  }

  function cancelAutoJoin() {
    if (autoJoinTimerRef.current) clearTimeout(autoJoinTimerRef.current);
    if (autoJoinIntervalRef.current) clearInterval(autoJoinIntervalRef.current);
    setAutoJoinPending(false);
    setAutoJoinCountdown(0);
  }

  return (
    <>
      <Head>
        <title>Armageddon Chess</title>
      </Head>
      <main className="container">
      <h1>Armageddon Chess</h1>

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

      {autoJoinPending && (
        <div style={{ padding: 12, background: '#fff3cd', border: '1px solid #ffeeba', marginBottom: 12 }}>
          Reloading to join in <strong>{autoJoinCountdown}s</strong>.
          <button onClick={cancelAutoJoin} style={{ marginLeft: 12 }}>Cancel</button>
        </div>
      )}

      {!gameType ? (
        <div>
          <h2>Choose Game Type</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
            <button
              onClick={() => setGameType('public')}
              style={{ padding: '16px 24px', fontSize: '16px' }}
            >
              🌐 Public Game
              <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                Play with random opponents
              </div>
            </button>
            <button
              onClick={() => setGameType('private')}
              style={{ padding: '16px 24px', fontSize: '16px' }}
            >
              🔒 Private Game
              <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                Create a shareable room for friends
              </div>
            </button>
          </div>
        </div>
      ) : gameType === 'private' ? (
        <div>
          <button 
            onClick={() => setGameType(null)}
            style={{ marginBottom: 16, background: 'none', border: 'none', color: '#007bff', cursor: 'pointer' }}
          >
            ← Back
          </button>
          <h2>Create Private Room</h2>
          
          <input
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ marginBottom: 16, padding: '8px', fontSize: '14px', width: '200px' }}
          />
          
          <div>
            <h3>Time Control:</h3>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {TIME_CONTROLS.map(tc => (
                <button
                  key={tc.minutes}
                  onClick={() => createPrivateRoom(tc.minutes)}
                  disabled={loading || !name.trim()}
                  style={{ padding: '12px 16px' }}
                >
                  {loading ? 'Creating...' : tc.display}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <button 
            onClick={() => setGameType(null)}
            style={{ marginBottom: 16, background: 'none', border: 'none', color: '#007bff', cursor: 'pointer' }}
          >
            ← Back
          </button>
          <h2>Join Public Game</h2>
          
          <input
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ marginBottom: 16, padding: '8px', fontSize: '14px', width: '200px' }}
          />
          
          <div>
            <h3>Choose Time Control:</h3>
            
            {/* Queue Status Display */}
            <div style={{ background: '#f8f9fa', padding: '12px', borderRadius: '6px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 8px 0' }}>
                <h4 style={{ margin: 0, fontSize: '14px' }}>
                  📊 Live Queue Status
                  <span style={{ fontSize: '10px', color: '#28a745', marginLeft: '8px' }}>● Real-time</span>
                </h4>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: '12px' }}>
                {TIME_CONTROLS.map(tc => {
                  const queueData = queueStatus[tc.ms.toString()];
                  const queueLength = queueData?.queueLength || 0;
                  const estimate = queueData?.estimate;
                  
                  return (
                    <div key={tc.minutes} style={{ 
                      padding: '8px', 
                      background: queueLength > 0 ? '#e8f5e8' : '#f8f9fa',
                      borderRadius: '4px',
                      border: queueLength > 0 ? '1px solid #28a745' : '1px solid #dee2e6'
                    }}>
                      <strong>{tc.display}:</strong> {queueLength} waiting
                      {estimate && (
                        <div style={{ 
                          color: estimate.type === 'match_now' ? '#28a745' : '#666',
                          fontWeight: estimate.type === 'match_now' ? 'bold' : 'normal'
                        }}>
                          {estimate.type === 'match_now' && '🔥 '}
                          {estimate.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ 
                marginTop: '8px', 
                paddingTop: '8px', 
                borderTop: '1px solid #dee2e6', 
                fontSize: '11px', 
                color: '#6c757d',
                fontStyle: 'italic'
              }}>
                � Updates automatically when players join or leave queues
              </div>
            </div>
            
            {/* Cancel Queue Button */}
            {isQueued && (
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={cancelQueue}
                  style={{ 
                    padding: '8px 16px', 
                    background: '#dc3545', 
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  ❌ Leave Queue
                </button>
                <span style={{ marginLeft: 12, fontSize: '12px', color: '#666' }}>
                  You're currently in queue - you'll be matched automatically!
                  {queueTimeRemaining !== null && (
                    <span style={{ color: '#ff6b6b', fontWeight: 'bold' }}>
                      {' '}Time remaining: {Math.ceil(queueTimeRemaining / 60000)}m {Math.floor((queueTimeRemaining % 60000) / 1000)}s
                    </span>
                  )}
                </span>
              </div>
            )}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => joinAllPublicQueues()}
                disabled={loading || !name.trim() || isQueued}
                style={{ padding: '12px 16px', background: '#28a745', color: 'white' }}
              >
                {loading ? 'Searching...' : `🎯 Join All Queues (${TIME_CONTROLS.map(tc => tc.minutes).join('/')})`}
              </button>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: 8 }}>
                Joins the first available game in any time control
              </div>
              
              <div style={{ display: 'flex', gap: 8 }}>
                {TIME_CONTROLS.map(tc => (
                  <button
                    key={tc.minutes}
                    onClick={() => joinPublicQueue(tc.minutes)}
                    disabled={loading || !name.trim() || isQueued}
                    style={{ padding: '12px 16px' }}
                  >
                    {loading ? 'Joining...' : tc.display}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
    </>
  );
}
