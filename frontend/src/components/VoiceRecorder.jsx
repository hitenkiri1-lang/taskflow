import { useState, useRef } from 'react'
import api from '../api/axios'

export default function VoiceRecorder({ onResult, onStatusClear }) {
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  const startRecording = async () => {
    onStatusClear()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await sendAudio(blob)
      }

      mediaRecorder.start()
      setRecording(true)
    } catch {
      onResult({ success: false, message: 'Microphone access denied.' })
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
    setProcessing(true)
  }

  const sendAudio = async (blob) => {
    const formData = new FormData()
    formData.append('audio', blob, 'recording.webm')
    try {
      const { data } = await api.post('/voice-command', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onResult({ success: true, ...data })
    } catch (err) {
      const detail = err.response?.data?.detail || 'Voice command failed.'
      // Map backend "not registered" error to friendly message
      const message = detail.toLowerCase().includes('not registered') || detail.toLowerCase().includes('is not registered')
        ? 'User not found with this name.'
        : detail
      onResult({ success: false, message })
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="bg-gray-900 rounded-2xl p-6 flex flex-col items-center gap-4">
      <p className="text-gray-400 text-sm">
        {recording
          ? 'Recording… speak your command'
          : processing
          ? 'Processing your command…'
          : 'Press and hold to record a voice command'}
      </p>

      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        disabled={processing}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-all shadow-lg
          ${recording
            ? 'bg-red-600 scale-110 animate-pulse'
            : processing
            ? 'bg-gray-700 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-500 active:scale-95'
          }`}
      >
        {processing ? '⏳' : recording ? '⏹' : '🎙️'}
      </button>

      <p className="text-xs text-gray-600">
        Example: "Assign task to Raj to fix login bug with high priority"
      </p>
    </div>
  )
}
