import { useRouter } from 'next/router';
import { useState, useEffect, useRef } from 'react';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoJoinPending, setAutoJoinPending] = useState(false);
  const [autoJoinCountdown, setAutoJoinCountdown] = useState(0);
  const autoJoinTimerRef = useRef(null);
  const autoJoinIntervalRef = useRef(null);

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
    if (queryName) {
      setName(decodeURIComponent(queryName));
    }
  }, [router.query]);

  async function playPublic() {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }
    setLoading(true);
    try {
      const playerId = getOrCreatePlayerId();
      const res = await fetch(`${BASE}/rooms/join-next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: name.trim() }),
      });
      if (!res.ok) {
        if (res.status === 404) {
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
      alert('Network error joining game');
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
      alert('Network error creating room');
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

      <input
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && playPublic()}
      />

      <div className="actions">
        <button
          onClick={playPublic}
          disabled={loading || !name.trim()}
        >
          {loading ? 'Joining...' : 'Play Public'}
        </button>

        <button
          onClick={playPrivate}
          disabled={loading || !name.trim()}
          style={{ marginLeft: 8 }}
        >
          {loading ? 'Creating...' : 'Play Private'}
        </button>
      </div>
    </main>
  );
}