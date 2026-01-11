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

  async function create() {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }
    // If we're already on a room URL, auto-join that room instead of creating a new one
    if (typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.startsWith('/room/')) {
      console.log('Auto-join: already on a /room/ URL', window.location.pathname);
      const playerId = crypto.randomUUID();
      localStorage.setItem('playerName', name.trim());
      localStorage.setItem('playerId', playerId);
      // Start a visible countdown and allow cancel so user can copy logs
      const delayMs = 8000;
      setAutoJoinCountdown(Math.ceil(delayMs / 1000));
      setAutoJoinPending(true);
      console.log('Reloading to join in', Math.ceil(delayMs / 1000), 's — copy console/network logs now if needed');
      autoJoinTimerRef.current = setTimeout(() => {
        window.location.reload();
      }, delayMs);
      autoJoinIntervalRef.current = setInterval(() => {
        setAutoJoinCountdown((c) => {
          if (c <= 1) {
            clearInterval(autoJoinIntervalRef.current);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      return;
    }

    setLoading(true);
    try {
      const createRes = await fetch(`${BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({ error: 'unknown' }));
        alert('Failed to create room: ' + (err.error || createRes.status));
        setLoading(false);
        return;
      }

      const createData = await createRes.json();
      console.log('create response', createData);
      // try several locations for roomId in case the backend shape varies
      const roomId = createData?.roomId || createData?.meta?.roomId || (createData?.meta && createData.meta.room && createData.meta.room.roomId) || null;
      if (!roomId) {
        alert('No room ID returned — check console for create response');
        setLoading(false);
        return;
      }

      const playerId = crypto.randomUUID();
      localStorage.setItem('playerName', name.trim());
      localStorage.setItem('playerId', playerId);

      // Strip 'room-' prefix for clean URL display
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
        setLoading(false);
        return;
      }
      const data = await res.json();
      const room = data.room || data;
      if (!room || !room.roomId) {
        alert('No room returned from quick match');
        setLoading(false);
        return;
      }
      localStorage.setItem('playerName', name.trim());
      localStorage.setItem('playerId', playerId);
      // Strip 'room-' prefix for clean URL display
      const displayId = room.roomId.replace(/^room-/, '');
      router.push(`/room/${displayId}`);
    } catch (e) {
      console.error(e);
      alert('Network error joining quick match');
    } finally {
      setLoading(false);
    }
  }

  function cancelAutoJoin() {
    if (autoJoinTimerRef.current) {
      clearTimeout(autoJoinTimerRef.current);
      autoJoinTimerRef.current = null;
    }
    if (autoJoinIntervalRef.current) {
      clearInterval(autoJoinIntervalRef.current);
      autoJoinIntervalRef.current = null;
    }
    setAutoJoinPending(false);
    setAutoJoinCountdown(0);
    console.log('Auto-join cancelled by user');
  }

  return (
    <main className="container">
      <h1>Armageddon Chess</h1>
      {autoJoinPending && (
        <div style={{ padding: 12, background: '#fff3cd', border: '1px solid #ffeeba', marginBottom: 12 }}>
          Reloading to join in <strong>{autoJoinCountdown}s</strong>. Copy console/network logs now if needed.
          <button onClick={cancelAutoJoin} style={{ marginLeft: 12 }}>Cancel</button>
        </div>
      )}
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
      />
      <div className="actions">
        <button onClick={create} disabled={loading || !name.trim()}>
          {loading ? 'Creating...' : 'Play'}
        </button>
        <button onClick={quickMatch} disabled={loading || !name.trim()} style={{ marginLeft: 8 }}>
          {loading ? 'Joining...' : 'Quick Match'}
        </button>
      </div>
    </main>
  );
}