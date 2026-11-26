"""Soundtrack for locally rendered videos: AI voice-over + synthesized music.

The ffmpeg "Ken Burns" renderer produces silent clips. ``add_soundtrack``
muxes in:

* a voice-over: the fast text model writes a short script sized to the clip,
  Gemini TTS reads it (free tier, speaks the brief's language);
* a soft music bed synthesized locally by ffmpeg (no external service, so it
  always works), ducked under the voice.

Voice is best-effort: without a Google AI key, or if every TTS model is
busy, the clip still gets the music bed.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

import httpx

from .runtime_config import resolved_settings

log = logging.getLogger("datalia.video_audio")

# Tried in order; the free tier rate-limits each model separately.
TTS_MODELS = (
    "gemini-2.5-flash-preview-tts",
    "gemini-3.1-flash-tts-preview",
    "gemini-3.8-flash-tts",
)
TTS_VOICE = "Kore"
_TTS_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_WORDS_PER_SECOND = 2.2
_SAMPLE_RATE = 44100

# Cmaj7 - Am7 - Fmaj7 - G, four seconds each (Hz).
_CHORDS = (
    (130.81, 261.63, 329.63, 392.00, 493.88),
    (110.00, 220.00, 261.63, 329.63, 392.00),
    (87.31, 174.61, 220.00, 261.63, 329.63),
    (98.00, 196.00, 246.94, 293.66, 392.00),
)


def _ffmpeg_exe() -> str:
    from imageio_ffmpeg import get_ffmpeg_exe

    return get_ffmpeg_exe()


async def _run(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        tail = (stderr or b"")[-400:].decode("utf-8", errors="replace")
        raise RuntimeError(f"ffmpeg failed: {tail}")


def _is_google_key(key: str) -> bool:
    return (key or "").startswith(("AIza", "AQ."))


def music_expression() -> str:
    """aevalsrc expression: a slow chord pad with a swell per chord.

    The amplitude envelope is zero at every chord boundary, so switching
    frequencies there can't click.
    """
    k = "floor(mod(t,16)/4)"
    env = "(0.5-0.5*cos(2*PI*mod(t,4)/4))"
    voices = []
    for idx in range(len(_CHORDS[0])):
        freqs = [chord[idx] for chord in _CHORDS]
        freq = f"if(eq({k},0),{freqs[0]},if(eq({k},1),{freqs[1]},if(eq({k},2),{freqs[2]},{freqs[3]})))"
        gain = 0.09 if idx == 0 else 0.055
        voices.append(f"{gain}*sin(2*PI*{freq}*t)")
    return f"{env}*({'+'.join(voices)})"


def _word_budget(duration_seconds: int) -> int:
    return max(6, int((max(duration_seconds, 3) - 1) * _WORDS_PER_SECOND))


def _clean_script(text: str, max_words: int) -> str:
    text = re.sub(r"[#*_`\"“”«»]", "", text or "").strip()
    text = re.sub(r"\s+", " ", text)
    words = text.split(" ")
    if len(words) > max_words:
        text = " ".join(words[:max_words]).rstrip(",;:") + "."
    return text


async def write_narration_script(prompt: str, duration_seconds: int, *, user_id: Any = None) -> str:
    """Short voice-over in the brief's language, sized for the clip."""
    from .services import _post_chat

    cfg = resolved_settings(user_id)
    max_words = _word_budget(duration_seconds)
    payload = {
        "model": cfg.ai_model_fast or cfg.ai_model,
        "temperature": 0.7,
        "max_tokens": 200,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You write voice-overs for short promotional social media videos. "
                    "Write in the same language as the brief. Natural spoken style, "
                    "one to three short sentences. No emojis, hashtags, quotes, "
                    "stage directions or speaker labels. Return only the spoken text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Video length: {duration_seconds} seconds. At most {max_words} words.\n"
                    f"Brief: {prompt.strip()}"
                ),
            },
        ],
    }
    text, _usage = await _post_chat(payload, workflow="video_voiceover", tier="fast", user_id=user_id)
    return _clean_script(text, max_words)


def _pcm_rate(mime: str) -> int:
    match = re.search(r"rate=(\d+)", mime or "")
    return int(match.group(1)) if match else 24000


async def synthesize_speech(text: str, workdir: Path, *, user_id: Any = None) -> Path | None:
    """Read ``text`` with Gemini TTS; return a WAV path, or None if unavailable."""
    cfg = resolved_settings(user_id)
    if not text or not _is_google_key(cfg.ai_api_key):
        return None
    body = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": TTS_VOICE}}},
        },
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        for model in TTS_MODELS:
            try:
                resp = await client.post(
                    _TTS_URL.format(model=model),
                    headers={"x-goog-api-key": cfg.ai_api_key, "Content-Type": "application/json"},
                    json=body,
                )
            except Exception as exc:  # network blip: try the next model
                log.warning("[video-audio] TTS %s failed: %s", model, exc)
                continue
            if resp.status_code != 200:
                log.warning("[video-audio] TTS %s returned HTTP %s", model, resp.status_code)
                continue
            parts = (((resp.json().get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
            inline = next((p.get("inlineData") for p in parts if p.get("inlineData")), None)
            if not inline or not inline.get("data"):
                continue
            raw = base64.b64decode(inline["data"])
            mime = (inline.get("mimeType") or "").lower()
            wav = workdir / "voice.wav"
            if "wav" in mime:
                wav.write_bytes(raw)
            else:  # raw 16-bit little-endian mono PCM ("audio/L16;rate=24000")
                pcm = workdir / "voice.pcm"
                pcm.write_bytes(raw)
                await _run([
                    _ffmpeg_exe(), "-y", "-f", "s16le", "-ar", str(_pcm_rate(mime)),
                    "-ac", "1", "-i", str(pcm), str(wav),
                ])
            return wav
    return None


async def media_duration(path: Path) -> float | None:
    """Duration in seconds of an audio/video file (parsed from ffmpeg -i)."""
    proc = await asyncio.create_subprocess_exec(
        _ffmpeg_exe(), "-i", str(path),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", (stderr or b"").decode("utf-8", "replace"))
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


async def add_soundtrack(
    video: Path, prompt: str, duration_seconds: float, *, user_id: Any = None
) -> dict[str, bool]:
    """Mux a voice-over (when possible) and a music bed into ``video`` in place."""
    duration = round(max(float(duration_seconds), 1.0), 2)
    workdir = Path(tempfile.mkdtemp(prefix="datalia-audio-"))
    try:
        voice: Path | None = None
        try:
            script = await write_narration_script(prompt, max(int(duration), 3), user_id=user_id)
            voice = await synthesize_speech(script, workdir, user_id=user_id)
        except Exception as exc:
            log.warning("[video-audio] voice-over skipped: %s", exc)

        fade_out_start = round(max(duration - 1.5, 0), 2)
        music_gain = 0.45 if voice else 0.9
        music_src = (
            f"aevalsrc=exprs='{music_expression()}':s={_SAMPLE_RATE}:d={duration}"
        )
        cmd = [_ffmpeg_exe(), "-y", "-i", str(video)]
        if voice:
            cmd += ["-i", str(voice)]
        cmd += ["-f", "lavfi", "-i", music_src]
        music_idx = 2 if voice else 1
        music_chain = (
            f"[{music_idx}:a]lowpass=f=2000,volume={music_gain},"
            f"afade=t=in:d=1,afade=t=out:st={fade_out_start}:d=1.5"
        )
        # Limiter + final fade: the voice may still be talking at the cut.
        master = f"alimiter=limit=0.89,afade=t=out:st={round(max(duration - 0.4, 0), 2)}:d=0.4"
        if voice:
            graph = (
                f"{music_chain}[mu];"
                f"[1:a]aresample={_SAMPLE_RATE},adelay=400|400[vo];"
                f"[mu][vo]amix=inputs=2:duration=first:normalize=0,{master}[aout]"
            )
        else:
            graph = f"{music_chain},{master}[aout]"
        out = workdir / "with-audio.mp4"
        cmd += [
            "-filter_complex", graph,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
            "-t", str(duration), "-shortest", "-movflags", "+faststart",
            str(out),
        ]
        await _run(cmd)
        shutil.move(str(out), str(video))
        return {"voice": voice is not None, "music": True}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
