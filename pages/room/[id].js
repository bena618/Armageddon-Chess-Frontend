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
            setError(err.error || 'Failed to join');
            setLoading(false);
            return;
          }

          setJoined(true);
          await fetchState();
        } catch (e) {
          setError('Network error joining room');
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
          const res = await fetch(`${BASE}/rooms/${id}`);
          if (!res.ok) throw new Error('Failed to fetch state');
          const data = await res.json();
          setState(data.room || data);
        } catch (e) {
          setError('Failed to load room state');
        }
      }

      useEffect(() => {
        if (!id || !joined) return;

        const interval = setInterval(fetchState, 2000);
        fetchState();

        return () => clearInterval(interval);
      }, [id, joined]);

      function copyLink() {
        navigator.clipboard.writeText(window.location.href.replace(/\?.*/, ''));
        alert('Link copied!');
      }

      if (!id) return <div className="container">Loading room...</div>;

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
              <pre>
                {state
                  ? JSON.stringify(
                      {
                        phase: state.phase,
                        players: state.players,
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