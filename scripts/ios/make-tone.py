# usage: python3 scripts/ios/make-tone.py <out.wav>
# 120 s, 8 kHz, 8-bit mono 440 Hz tone (~960 KB), served as the QA recording for every chapter in the CI fixture
# (long enough to still be playing after the 20 s background step).
# Generated at run time so no audio file lives in the repository.
import math, os, sys, wave

path = sys.argv[1]
os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
rate = 8000
with wave.open(path, 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(1)
    out.setframerate(rate)
    out.writeframes(bytes(int(128 + 60 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(rate * 120)))
