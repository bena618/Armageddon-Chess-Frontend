import { useRouter } from 'next/router';
import { useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function create() {
    if (!name.trim()) {
      alert('Please enter your name');
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
      const roomId = createData.roomId;
      if (!roomId) {
        alert('No room ID returned');
        setLoading(false);
        return;
      }

      const playerId = crypto.randomUUID();
      localStorage.setItem('playerName', name.trim());
      localStorage.setItem('playerId', playerId);

      router.push(`/room/${roomId}`);
    } catch (e) {
      console.error(e);
      alert('Network error creating room');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <h1>Armageddon Chess</h1>
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
      </div>
    </main>
  );
}