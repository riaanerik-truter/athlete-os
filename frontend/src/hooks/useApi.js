import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API_KEY = 'sk-local-kzS5FHuBZ6TNI214'
const HEADERS  = { 'X-API-Key': API_KEY }

// ---------------------------------------------------------------------------
// useApi â€” for mutations (POST, PATCH, DELETE) and ad-hoc fetches
// Returns { request, loading, error }
// ---------------------------------------------------------------------------

export function useApi() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const request = useCallback(async (method, path, data = null) => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios({ method, url: `/api/v1${path}`, data, headers: HEADERS })
      return res.data
    } catch (err) {
      const msg = err.response?.data?.error?.message ?? err.message
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { request, loading, error }
}

// ---------------------------------------------------------------------------
// useFetch â€” for GET requests that load on mount
// Returns { data, loading, error, reload }
// ---------------------------------------------------------------------------

export function useFetch(path, { skip = false } = {}) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(!skip)
  const [error, setError]     = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get(`/api/v1${path}`, { headers: HEADERS })
      setData(res.data)
    } catch (err) {
      const msg = err.response?.data?.error?.message ?? err.message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    if (!skip) fetch()
  }, [fetch, skip])

  return { data, loading, error, reload: fetch }
}
