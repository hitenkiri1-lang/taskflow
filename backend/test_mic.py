import os
import json
import numpy as np
import sounddevice as sd
import scipy.io.wavfile as wav
import requests

# --- Config ---
BACKEND_URL = "http://127.0.0.1:8000/api/voice-command"
OUTPUT_FILE = "temp_test_audio.wav"
DURATION = 5       # seconds
SAMPLE_RATE = 16000  # 16kHz is what Whisper expects


def record_audio():
    print("\n" + "=" * 50)
    print("🎤  RECORDING NOW - Speak your task! (5 seconds)...")
    print("=" * 50 + "\n")

    audio = sd.rec(
        int(DURATION * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
    )
    sd.wait()  # Block until recording is done

    print("✅  Recording complete. Saving audio...\n")
    wav.write(OUTPUT_FILE, SAMPLE_RATE, audio)


def send_to_backend():
    print(f"📤  Sending '{OUTPUT_FILE}' to {BACKEND_URL} ...")

    with open(OUTPUT_FILE, "rb") as f:
        response = requests.post(
            BACKEND_URL,
            files={"audio": (OUTPUT_FILE, f, "audio/wav")},
            timeout=120,  # Whisper + Ollama can take a moment
        )

    print(f"📥  Response status: {response.status_code}\n")

    try:
        data = response.json()
        print("--- SERVER RESPONSE ---")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print("-----------------------\n")
    except Exception:
        print("⚠️  Could not parse JSON. Raw response:")
        print(response.text)


def cleanup():
    if os.path.exists(OUTPUT_FILE):
        os.remove(OUTPUT_FILE)
        print(f"🗑️   Cleaned up '{OUTPUT_FILE}'.")


if __name__ == "__main__":
    try:
        record_audio()
        send_to_backend()
    finally:
        cleanup()
