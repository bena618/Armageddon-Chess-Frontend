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
  const [isQueued, setIsQueued] = useState(false);
  const [queueStartTime, setQueueStartTime] = useState(null);
  const [queueTimeRemaining, setQueueTimeRemaining] = useState(null);
  const [toast, setToast] = useState(null);
  const autoJoinTimerRef = useRef(null);
  const autoJoinIntervalRef = useRef(null);
  const matchCheckIntervalRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const wsRef = useRef(null);

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

            if (matchCheckIntervalRef.current) clearInterval(matchCheckIntervalRef.current);

            matchCheckIntervalRef.current = setInterval(async () => {
              try {
                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                  const matchRes = await fetch(`${BASE}/queue/checkMatch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId }),
                  });

                  if (matchRes.ok) {
                    const matchData = await matchRes.json();

                    if (matchData.matched && matchData.roomId) {
                      clearInterval(matchCheckIntervalRef.current);
                      const displayId = matchData.roomId.replace(/^room-/, '');
                      router.push(`/room/${displayId}`);
                      return;
                    }

                    if (!matchData.inQueue && !matchData.matched) {
                      clearInterval(matchCheckIntervalRef.current);
                      setIsQueued(false);
                      return;
                    }

                    if (matchData.estimate?.type === 'countdown' && matchData.estimate.durationMs < 10000) {
                      clearInterval(matchCheckIntervalRef.current);
                      matchCheckIntervalRef.current = setInterval(arguments.callee, 1000);
                    }
                  }
                }
              } catch (e) {}
            }, 5000);

            setTimeout(() => {
              if (matchCheckIntervalRef.current) clearInterval(matchCheckIntervalRef.current);
            }, 120000);
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
      const wsUrl = `${BASE.replace(/^http/, 'ws')}/rooms/${matchmakingRoomId}/ws?playerId=${playerId}`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {};

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'matched' && data.roomId) {
            if (matchCheckIntervalRef.current) {
              clearInterval(matchCheckIntervalRef.current);
            }
            const displayId = data.roomId.replace(/^room-/, '');
            router.push(`/room/${displayId}`);
          }
        } catch (e) {}
      };

      wsRef.current.onclose = () => {
        if (isQueued) {
          setTimeout(setupMatchWebSocket, 3000);
        }
      };

      wsRef.current.onerror = () => {};
    };

    setupMatchWebSocket();
    
    const heartbeat = setInterval(async () => {
      try {
        await fetch(`${BASE}/queue/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        });
      } catch (e) {}
    }, 300000);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      clearInterval(heartbeat);
    };
  }, [isQueued]);

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

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch(`${BASE}/queue/status`);
      if (res.ok) {
        const data = await res.json();
        setQueueStatus(data.estimates || {});
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (!isQueued || !queueStartTime) return;

    const updateRemainingTime = () => {
      const elapsed = Date.now() - queueStartTime;
      const remaining = Math.max(0, 20 * 60 * 1000 - elapsed);
      setQueueTimeRemaining(remaining);

      if (remaining === 0) {
        cancelQueue();
        showToast('You\'ve been in queue for 20 minutes and have been automatically removed. Please rejoin if you still want to play.', 'warning');
      }
    };

    updateRemainingTime();
    const interval = setInterval(updateRemainingTime, 1000);

    return () => clearInterval(interval);
  }, [isQueued, queueStartTime]);

  useEffect(() => {
    if (gameType !== 'public') return;

    fetchQueueStatus();
    const interval = setInterval(fetchQueueStatus, 60000);

    return () => clearInterval(interval);
  }, [gameType]);

  useEffect(() => {
    if (!isQueued) return;

    fetchQueueStatus();

    const updateInterval = () => {
      const hasCountdowns = Object.values(queueStatus).some(status => status?.estimate?.type === 'countdown');
      return hasCountdowns ? 30000 : 120000;
    };

    const interval = setInterval(fetchQueueStatus, updateInterval());

    return () => clearInterval(interval);
  }, [isQueued]);

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
      setQueueStartTime(null);
      setQueueTimeRemaining(null);

      try {
        const res = await fetch(`${BASE}/queue/status`);
        if (res.ok) {
          const data = await res.json();
          setQueueStatus(data.estimates || {});
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
        setQueueStartTime(Date.now());
        showToast(`You're in queue for ${time} minutes. Position: ${data.queuePosition || 1}. You'll be matched automatically!`, 'success');
        setLoading(false);
        
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
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Current Queue Status:</h4>
              <div style={{ display: 'flex', gap: 16, fontSize: '12px' }}>
                {TIME_CONTROLS.map(tc => (
                  <div key={tc.minutes}>
                    <strong>{tc.display}:</strong> {queueStatus[tc.ms]?.queueLength || 0} waiting
                    {getWaitMessage(queueStatus[tc.ms]?.estimate)}
                  </div>
                ))}
              </div>
              <div style={{ 
                marginTop: '8px', 
                paddingTop: '8px', 
                borderTop: '1px solid #dee2e6', 
                fontSize: '11px', 
                color: '#6c757d',
                fontStyle: 'italic'
              }}>
                💡 Wait estimates are based on current game times. May take longer if players rematch or games extend beyond expected duration.
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
