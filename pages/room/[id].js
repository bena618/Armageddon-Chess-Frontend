import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function Room() {
  const router = useRouter();
  const { id } = router.query;

  const [state, setState] = useState(null);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    try {
      const res = await fetch(`${BASE}/rooms/${id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: playerName }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        setError(err.error || 'Failed to auto-join room');
        setLoading(false);
        return;
      }

      setJoined(true);
      await fetchState();
    } catch (e) {
      setError('Network error auto-joining room');
      setLoading(false);
    }
  }

  async function join() {
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    const playerId = crypto.randomUUID();

    localStorage.setItem('playerName', name.trim());
    localStorage.setItem('playerId', playerId);

    await autoJoin(playerId, name.trim());
  }

  async function fetchState() {
    try {
      const res = await fetch(`${BASE}/rooms/${id}`);
      if (!res.ok) throw new Error('Failed to fetch state');
      const data = await res.json();
      setState(data.room || data);
    } catch (e) {
      console.error(e);
      setError('Failed to load room state');
    }
  }

  useEffect(() => {
    if (!id || !joined) return;

    fetchState(); // Initial fetch
    const interval = setInterval(fetchState, 2000);

    return () => clearInterval(interval);
  }, [id, joined]);

  function copyLink() {
    const cleanUrl = window.location.origin + window.location.pathname;
    navigator.clipboard.writeText(cleanUrl);
  }

  if (!id) return <div className="container">Loading room...</div>;

  if (loading && !joined) return <div className="container">Joining room...</div>;

  return (
    <main className="container">
      <h2>Room {id}</h2>

      <div className="share">
        <input readOnly value={typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''} />
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
          <pre>
            {state
              ? JSON.stringify(
                  {
                    phase: state.phase,
                    players: state.players.map(p => ({ name: p.name, id: p.id.slice(0, 8) + '...' })),
                    bids: state.bids ? Object.keys(state.bids) : [],
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