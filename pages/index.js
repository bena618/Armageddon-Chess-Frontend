import { useRouter } from 'next/router'
import { useState } from 'react'
const BASE = 'https://armageddon-chess.benaharon1.workers.dev'
export default function Home(){
  const r = useRouter()
  const [name,setName]=useState('')
  const [loading,setLoading]=useState(false)
  async function create(){
    setLoading(true)
    const res = await fetch(`${BASE}/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})})
    const j = await res.json()
    const roomId = j.roomId || j?.meta?.roomId || j?.roomId
    r.push(`/room/${roomId}?name=${encodeURIComponent(name)}`)
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
