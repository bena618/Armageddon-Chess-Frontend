import { useRouter } from 'next/router'
import { useState } from 'react'
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL; 

export default function Home(){
  const r = useRouter()
  const [name,setName]=useState('')
  const [loading,setLoading]=useState(false)
  async function create(){
    setLoading(true)
    try {
      const res = await fetch(`${BASE}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        alert('Failed to create room: ' + (err.error || res.statusText));
        return;
      }
      const j = await res.json().catch(() => ({}));
      const roomId = j.roomId || j?.meta?.roomId || j?.roomId;
      if (!roomId) return alert('No room id returned');
      r.push(`/room/${roomId}?name=${encodeURIComponent(name)}`);
    } catch (e) {
      alert('Network error creating room');
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="container">
      <h1>Armageddon Chess</h1>
      <input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} />
      <div className="actions">
        <button onClick={create} disabled={loading||!name}>Play</button>
      </div>
    </main>
  ) 
}
