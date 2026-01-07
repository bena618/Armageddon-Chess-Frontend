import {useRouter} from 'next/router'
import {useEffect,useState} from 'react'
const BASE='https://armageddon-chess.benaharon1.workers.dev'
export default function Room(){
  const r = useRouter();
  const {id} = r.query;
  const [state,setState]=useState(null)
  const [name,setName]=useState('')
  const [joined,setJoined]=useState(false)

  useEffect(()=>{ if (r.query.name) setName(r.query.name) },[r.query])
  useEffect(()=>{ if (!id) return; fetchState() },[id])
  async function fetchState(){
    const res = await fetch(`${BASE}/rooms/${id}`)
    const j = await res.json()
    setState(j.room)
  }
  async function join(){
    if(!name) return
    await fetch(`${BASE}/rooms/${id}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:name,name})})
    setJoined(true)
    fetchState()
  }
  function copyLink(){ navigator.clipboard.writeText(location.href) }
  if(!id) return <div className="container">Loading…</div>
  return (
    <main className="container">
      <h2>Room {id}</h2>
      <div className="share">
        <input readOnly value={typeof window !== 'undefined' ? window.location.href : ''} />
        <button onClick={copyLink}>Copy Link</button>
      </div>
      <div className="join">
        <input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} />
        <button onClick={join} disabled={joined||!name}>Join</button>
      </div>
      <section className="state">
        <pre>{state ? JSON.stringify({phase:state.phase,players:state.players,map:state.bids?Object.keys(state.bids):[]},null,2) : 'No state'}</pre>
      </section>
    </main>
  )
}
