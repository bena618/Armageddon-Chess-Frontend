import { useRouter } from 'next/router';
import { useState, useEffect, useRef } from 'react';

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
  const autoJoinTimerRef = useRef(null);
  const autoJoinIntervalRef = useRef(null);
  const matchCheckIntervalRef = useRef(null);

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
                }
              } catch (e) {}
            }, 10000);

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

    const heartbeat = setInterval(async () => {
      try {
        await fetch(`${BASE}/queue/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        });
      } catch (e) {}
    }, 300000);

    return () => clearInterval(heartbeat);
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
    if (!isQueued) return;

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
        alert('You\'ve been in queue for 20 minutes and have been automatically removed. Please rejoin if you still want to play.');
      }
    };

    updateRemainingTime();
    const interval = setInterval(updateRemainingTime, 1000);

    return () => clearInterval(interval);
  }, [isQueued, queueStartTime]);

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

      alert('You left the queue');
    } catch (e) {
      alert('Failed to leave queue');
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
      alert('Please enter your name');
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
        alert('Failed to join queue: ' + (err.error || res.status));
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
        alert(`You're in queue for ${time} minutes. Position: ${data.queuePosition || 1}. You'll be matched automatically!`);
        setLoading(false);
        
        // Clear any existing match check interval
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
      alert('Network error joining queue');
      setLoading(false);
    }
  }

  async function joinAllPublicQueues() {
    if (!name.trim()) {
      alert('Please enter your name');
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
        alert('Failed to join queues: ' + (err.error || res.status));
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
        alert(`You're in queues for: ${data.joinedQueues.join(', ')} minutes. You'll be matched automatically!`);
        setLoading(false);
        
        // Clear any existing match check interval
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
        alert('No available queues found. You can create a private room instead!');
      }
    } catch (e) {
      alert('Network error joining queues');
      setLoading(false);
    }
  }

  async function createPrivateRoom(time) {
    if (!name.trim()) {
      alert('Please enter your name');
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
        alert('Failed to create room: ' + (err.error || res.status));
        return;
      }
      
      const data = await res.json();
      const roomId = data.roomId || data.meta?.roomId;
      if (!roomId) {
        alert('No room ID returned');
        return;
      }
      
      localStorage.setItem('playerName', name.trim());
      const displayId = roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}?private=true`);
    } catch (e) {
      alert('Network error creating room');
    } finally {
      setLoading(false);
    }
  }

  async function playPublic() {
    if (!name.trim()) {
      alert('Please enter your name');
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
          // Save player name BEFORE creating room
          localStorage.setItem('playerName', playerName);
          
          const createRes = await fetch(`${BASE}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ private: false, creatorName: playerName, creatorPlayerId: playerId }),
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({ error: 'unknown' }));
            alert('Failed to create room: ' + (err.error || createRes.status));
            return;
          }
          const data = await createRes.json();
          const roomId = data.roomId || data.meta?.roomId;
          if (!roomId) {
            alert('No room ID returned');
            return;
          }
          const displayId = roomId.replace(/^room-/, '');
          router.push(`/room/${displayId}`);
          return;
        }
        const err = await res.json().catch(() => ({}));
        alert('Quick match error: ' + (err.error || res.status));
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
            alert('Failed to create room: ' + (err.error || createRes.status));
            return;
          }
          const createData = await createRes.json();
          const roomId = createData.roomId || createData.meta?.roomId;
          if (!roomId) {
            alert('No room ID returned');
            return;
          }
          const displayId = roomId.replace(/^room-/, '');
          router.push(`/room/${displayId}`);
          return;
        }
        alert('Quick match error: ' + data.error);
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
            alert('Failed to create room: ' + (err.error || createRes.status));
            return;
          }
          const createData = await createRes.json();
          const roomId = createData.roomId || createData.meta?.roomId;
          if (!roomId) {
            alert('No room ID returned');
            return;
          }
          const displayId = roomId.replace(/^room-/, '');
          router.push(`/room/${displayId}`);
          return;
        }
        alert('Quick match error: ' + room.error);
        return;
      }
      
      if (!room?.roomId) {
        alert('No room returned');
        return;
      }
      localStorage.setItem('playerName', name.trim());
      const displayId = room.roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}`);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function playPrivate() {
    if (!name.trim()) {
      alert('Please enter your name');
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
        alert('Failed to create room: ' + (err.error || res.status));
        return;
      }
      const data = await res.json();
      const roomId = data.roomId || data.meta?.roomId;
      if (!roomId) {
        alert('No room ID returned');
        return;
      }
      const playerId = getOrCreatePlayerId();
      localStorage.setItem('playerName', name.trim());
      const displayId = roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}?private=true`);
    } catch (e) {
      console.error(e);
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
    <main className="container">
      <h1>Armageddon Chess</h1>

      {autoJoinPending && (
        <div style={{ padding: 12, background: '#fff3cd', border: '1px solid #ffeeba', marginBottom: 12 }}>
          Reloading to join in <strong>{autoJoinCountdown}s</strong>.
          <button onClick={cancelAutoJoin} style={{ marginLeft: 12 }}>Cancel</button>
        </div>
      )}

      {!gameType ? (
        // Screen 1: Game Type Selection
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
        // Screen 2: Private Game Setup
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
        // Screen 2: Public Game Setup
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
  );
}