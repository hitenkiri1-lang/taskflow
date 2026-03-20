import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

// Attach user_id header automatically when logged in
api.interceptors.request.use((config) => {
  const userId = localStorage.getItem('user_id')
  if (userId) {
    config.headers['X-User-Id'] = userId
  }
  console.log('Request URL:', (config.baseURL || '') + (config.url || ''))
  return config
})

export default api
