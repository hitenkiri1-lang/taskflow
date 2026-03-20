import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Square, Loader2 } from 'lucide-react'

export default function VoiceButton({ onResult }) {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)

  const handleClick = async () => {
    if (isProcessing) return

    if (!isRecording) {
      // ── START ──
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const mediaRecorder = new MediaRecorder(stream)
        mediaRecorderRef.current = mediaRecorder
        chunksRef.current = []

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        mediaRecorder.onstop = () => sendAudio()

        mediaRecorder.start()
        setIsRecording(true)
      } catch {
        onResult?.({ success: false, message: 'Microphone access denied.' })
      }
    } else {
      // ── STOP ──
      setIsRecording(false)
      setIsProcessing(true)
      mediaRecorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }

  const sendAudio = async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    const formData = new FormData()
    formData.append('audio', blob, 'recording.webm') // key must be "audio"

    try {
      const res = await fetch('/api/voice-command', {
        method: 'POST',
        headers: { 'X-User-Id': localStorage.getItem('user_id') || '' },
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        // 400 = user not registered or other known backend error
        const msg =
          res.status === 400 &&
          (data.detail?.toLowerCase().includes('not registered') ||
            data.detail?.toLowerCase().includes('is not registered'))
            ? 'User not found with this name.'
            : data.detail || `Error ${res.status}`
        onResult?.({ success: false, message: msg })
        return
      }

      onResult?.({ success: true, ...data })
    } catch {
      onResult?.({ success: false, message: 'Could not reach the server. Is the backend running?' })
    } finally {
      // Always reset — button never gets frozen
      setIsProcessing(false)
      setIsRecording(false)
    }
  }

  const helperText = isProcessing
    ? 'Processing with AI…'
    : isRecording
    ? 'Click to stop and send'
    : 'Click to start recording'

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Button + pulse ring */}
      <div className="relative flex items-center justify-center">
        {/* Pulse ring — only while recording */}
        <AnimatePresence>
          {isRecording && (
            <motion.span
              key="ring"
              className="absolute w-24 h-24 rounded-full bg-red-500"
              initial={{ scale: 1, opacity: 0.35 }}
              animate={{ scale: 1.75, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>

        <motion.button
          onClick={handleClick}
          disabled={isProcessing}
          whileHover={!isProcessing ? { scale: 1.08 } : {}}
          whileTap={!isProcessing ? { scale: 0.92 } : {}}
          animate={
            isRecording
              ? { scale: [1, 1.06, 1], transition: { duration: 1.2, repeat: Infinity } }
              : { scale: 1 }
          }
          aria-label={helperText}
          className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center
            text-white shadow-xl transition-colors duration-200
            ${isProcessing
              ? 'bg-slate-700 cursor-not-allowed'
              : isRecording
              ? 'bg-red-600'
              : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={isProcessing ? 'proc' : isRecording ? 'rec' : 'idle'}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              {isProcessing
                ? <Loader2 className="w-8 h-8 animate-spin" />
                : isRecording
                ? <Square className="w-7 h-7 fill-current" />
                : <Mic className="w-8 h-8" />
              }
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Dynamic helper text */}
      <AnimatePresence mode="wait">
        <motion.p
          key={helperText}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="text-sm text-slate-400"
        >
          {helperText}
        </motion.p>
      </AnimatePresence>

      <p className="text-xs text-slate-600 text-center max-w-xs">
        Try: "Assign task to Raj to fix the login bug with high priority"
      </p>
    </div>
  )
}
