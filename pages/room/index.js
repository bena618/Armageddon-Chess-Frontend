import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

function getIdFromPath() {
  if (typeof window === 'undefined') return null;
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] || null;
}

export default function RoomIndex() {
  const router = useRouter();
  const id = getIdFromPath();

  const [state, setState] = useState(null);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ws, setWs] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  function getBackendRoomIdFromDisplay(displayId) {
    if (!displayId) return null;
    return displayId.startsWith('room-') ? displayId : 'room-' + displayId;
  }

  useEffect(() => {
    if (!id) return;

    const savedName = localStorage.getItem('playerName');
    const savedPlayerId = localStorage.getItem('playerId');

    if (savedName && savedPlayerId) {
      setName(savedName);
      autoJoin(savedPlayerId, savedName);
    } else {
      setLoading(false);
    }
  }, [id]);

  async function autoJoin(playerId, playerName) {
    const parts = typeof window !== 'undefined' ? window.location.pathname.split('/').filter(Boolean) : [];
    const pathId = parts[1] || id;
    const backendId = getBackendRoomIdFromDisplay(pathId);
    try {
      console.log('RoomIndex autoJoin -> POST /rooms/' + backendId + '/join', { playerId, playerName });
      const res = await fetch(`${BASE}/rooms/${backendId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName }),
      });

      console.log('Join response status:', res.status);
      const body = await res.text().catch(() => null);
      try { console.log('Join response body:', body ? JSON.parse(body) : null); } catch (e) { console.log('Join body (raw):', body); }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        setError(err.error || 'Failed to join');
        setLoading(false);
        return;
      }

      setJoined(true);
      await fetchState();
      try {
        const p = window.location.pathname;
        router.replace(p + '?_joined=' + Date.now());
      } catch (e) { /* ignore */ }
    } catch (e) {
      console.error('autoJoin error', e);
      setError('Network error joining room: ' + (e && e.message));
    } finally {
      setLoading(false);
    }
  }

  async function join() {
    if (!name.trim()) return;

    setLoading(true);
    const playerId = crypto.randomUUID();

    localStorage.setItem('playerName', name.trim());
    localStorage.setItem('playerId', playerId);

    await autoJoin(playerId, name.trim());
  }

  async function fetchState() {
    try {
      const backendId = getBackendRoomIdFromDisplay(id);
      console.log('GET /rooms/' + backendId);
      const res = await fetch(`${BASE}/rooms/${backendId}`);
      console.log('fetchState status:', res.status);
      if (!res.ok) {
        const errBody = await res.text().catch(() => null);
        console.error('fetchState error body:', errBody);
        throw new Error('Failed to fetch state: ' + res.status);
      }
      const data = await res.json();
      console.log('fetchState body:', data);
      setState(data.room || data);
    } catch (e) {
      console.error('fetchState exception', e);
      setError('Failed to load room state: ' + (e && e.message));
    }
  }

  function connectWebSocket(playerId) {
    if (!id || !playerId) return;

    const backendId = getBackendRoomIdFromDisplay(id);
    const wsUrl = `${BASE.replace(/^http/, 'ws')}/rooms/${backendId}?playerId=${playerId}`;
    
    console.log('Connecting WebSocket:', wsUrl);
    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('WebSocket connected');
      setWs(websocket);
      setReconnectAttempts(0);
      setError(null);
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('WebSocket message:', message);
        
        if (message.type === 'init' || message.type === 'update') {
          setState(message.room);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    websocket.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      setWs(null);
      
      // Attempt reconnection with exponential backoff
      if (event.code !== 1000 && reconnectAttempts < 5) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`);
        setReconnectAttempts(prev => prev + 1);
        setTimeout(() => connectWebSocket(playerId), delay);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
    };

    return websocket;
  }

  useEffect(() => {
    if (!id || !joined) return;

    const playerId = localStorage.getItem('playerId');
    if (!playerId) return;

    const websocket = connectWebSocket(playerId);

    return () => {
      if (ws) {
        ws.close(1000, 'Component unmounting');
        setWs(null);
      }
    };
  }, [id, joined]);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href.replace(/\?.*/, ''));
    alert('Link copied!');
  }

  if (!id) return <div className="container">No room id in URL</div>;

  if (loading && !joined) return <div className="container">Joining room...</div>;

  return (
    <main className="container">
      <h2>Room {id}</h2>

      <div className="share">
        <input readOnly value={typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''} />
        <button onClick={copyLink}>Copy Link</button>
      </div>

      {!joined && (
        <div className="join">
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            disabled={loading}
          />
          <button onClick={join} disabled={loading || !name.trim()}>
            {loading ? 'Joining...' : 'Join'}
          </button>
          {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
      )}

      {joined && (
        <section className="state">
          <h3>Room State</h3>
          {error && <p style={{ color: 'red' }}>{error}</p>}
          {reconnectAttempts > 0 && <p style={{ color: 'orange' }}>Reconnecting... (attempt {reconnectAttempts})</p>}
          <pre>
            {state
              ? JSON.stringify(
                  {
                    phase: state?.phase,
                    players: state?.players,
                    bids: state?.bids ? Object.keys(state.bids) : [],
                  },
                  null,
                  2
                )
              : 'Loading state...'}
          </pre>
        </section>
      )}
    </main>
  );
}