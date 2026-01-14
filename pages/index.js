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

  // Pre-fill name from query param (e.g., from timeout redirect)
  useEffect(() => {
    const { name: queryName } = router.query;
    if (queryName) {
      setName(decodeURIComponent(queryName));
    }
  }, [router.query]);

  async function create() {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }

    setLoading(true);

    // If already on a /room/ URL, try to join it instead of creating new
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/room/')) {
      const pathId = window.location.pathname.split('/').filter(Boolean)[1];
      const backendId = pathId.startsWith('room-') ? pathId : `room-${pathId}`;

      const playerId = crypto.randomUUID();

      try {
        const res = await fetch(`${BASE}/rooms/${backendId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, name: name.trim() }),
        });

        if (res.ok) {
          localStorage.setItem('playerName', name.trim());
          localStorage.setItem('playerId', playerId);
          router.replace(window.location.pathname);
          return;
        }
      } catch (e) {
        console.error('Direct join failed', e);
      }

      // Fallback: show countdown and reload
      setAutoJoinCountdown(8);
      setAutoJoinPending(true);
      autoJoinTimerRef.current = setTimeout(() => window.location.reload(), 8000);
      autoJoinIntervalRef.current = setInterval(() => {
        setAutoJoinCountdown(c => c > 0 ? c - 1 : 0);
      }, 1000);
      setLoading(false);
      return;
    }

    // Normal room creation
    try {
      const res = await fetch(`${BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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

      const playerId = crypto.randomUUID();
      localStorage.setItem('playerName', name.trim());
      localStorage.setItem('playerId', playerId);

      const displayId = roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}`);
    } catch (e) {
      console.error(e);
      alert('Network error creating room');
    } finally {
      setLoading(false);
    }
  }

  async function quickMatch() {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }
    setLoading(true);
    try {
      const playerId = crypto.randomUUID();
      const res = await fetch(`${BASE}/rooms/join-next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: name.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('No available games: ' + (err.error || res.status));
        return;
      }
      const data = await res.json();
      const room = data.room || data;
      if (!room?.roomId) {
        alert('No room returned');
        return;
      }
      localStorage.setItem('playerName', name.trim());
      localStorage.setItem('playerId', playerId);
      const displayId = room.roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}`);
    } catch (e) {
      alert('Network error joining quick match');
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
        onKeyDown={e => e.key === 'Enter' && create()}
      />

      <div className="actions">
        <button
          onClick={create}
          disabled={loading || !name.trim()}
        >
          {loading ? 'Creating...' : 'Play'}
        </button>

        <button
          onClick={quickMatch}
          disabled={loading || !name.trim()}
          style={{ marginLeft: 8 }}
        >
          {loading ? 'Joining...' : 'Quick Match'}
        </button>
      </div>
    </main>
  );
}