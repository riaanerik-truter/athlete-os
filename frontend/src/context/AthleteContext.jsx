import { createContext, useContext, useEffect, useState } from 'react'
import axios from 'axios'
import { API_KEY } from '../config.js'

const AthleteContext = createContext(null)

export function AthleteProvider({ children }) {
  const [athlete, setAthlete]   = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [athleteRes, snapshotRes] = await Promise.allSettled([
        axios.get('/api/v1/athlete', { headers: { 'X-API-Key': API_KEY } }),
        axios.get('/api/v1/fitness/snapshot', { headers: { 'X-API-Key': API_KEY } }),
      ])
      if (athleteRes.status === 'fulfilled') setAthlete(athleteRes.value.data)
      if (snapshotRes.status === 'fulfilled') setSnapshot(snapshotRes.value.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <AthleteContext.Provider value={{ athlete, snapshot, loading, error, reload: load }}>
      {children}
    </AthleteContext.Provider>
  )
}

export function useAthlete() {
  const ctx = useContext(AthleteContext)
  if (!ctx) throw new Error('useAthlete must be used within AthleteProvider')
  return ctx
}
