import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** Shared play/pause + time state for a media element without its native controls. */
function useMedia<T extends HTMLMediaElement>() {
  const ref = useRef<T | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const sync = () => {
      setPlaying(!media.paused && !media.ended);
      setTime(media.currentTime);
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    };
    const events = ["play", "pause", "ended", "timeupdate", "loadedmetadata", "durationchange"] as const;
    events.forEach((name) => media.addEventListener(name, sync));
    return () => events.forEach((name) => media.removeEventListener(name, sync));
  }, []);
  const toggle = () => {
    const media = ref.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  };
  const seek = (ratio: number) => {
    const media = ref.current;
    if (media && duration > 0) media.currentTime = Math.min(Math.max(ratio, 0), 1) * duration;
  };
  return { ref, playing, time, duration, toggle, seek };
}

/** Seek bar as a slider (click / drag / arrow keys) — no native range input. */
function SeekBar({ time, duration, onSeek, label, className }: { time: number; duration: number; onSeek: (ratio: number) => void; label: string; className?: string }) {
  const ratio = duration > 0 ? time / duration : 0;
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek((event.clientX - box.left) / box.width);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    if (event.key === "ArrowRight") onSeek((time + 5) / duration);
    if (event.key === "ArrowLeft") onSeek((time - 5) / duration);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        fromPointer(event);
      }}
      onPointerMove={(event) => event.buttons === 1 && fromPointer(event)}
      onKeyDown={onKey}
      className={cn("relative h-4 flex-1 cursor-pointer touch-none outline-none focus-visible:ring-1 focus-visible:ring-current", className)}
    >
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-current opacity-25" />
      <span className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-current" style={{ width: `${ratio * 100}%` }} />
      <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" style={{ left: `${ratio * 100}%` }} />
    </div>
  );
}

/** Voice message player: play/pause, seek bar and elapsed / total time. */
export function AudioPlayer({ src }: { src: string }) {
  const { t } = useTranslation();
  const audio = useMedia<HTMLAudioElement>();
  return (
    <div className="mb-1 flex min-w-[200px] items-center gap-2 rounded-lg bg-black/5 px-2.5 py-1.5 dark:bg-black/20" data-testid="message-attachment">
      <audio ref={audio.ref} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={audio.toggle}
        aria-label={audio.playing ? t("chat.pause") : t("chat.play")}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-msg-primary text-msg-on-primary max-lg:size-11"
        data-testid="audio-toggle"
      >
        {audio.playing ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5 translate-x-px" aria-hidden="true" />}
      </button>
      <SeekBar time={audio.time} duration={audio.duration} onSeek={audio.seek} label={t("chat.mediaAudio")} />
      <span className="shrink-0 text-[10px] tabular-nums opacity-70">
        {clock(audio.time)} / {clock(audio.duration)}
      </span>
    </div>
  );
}

/** Inline video: poster frame with a play overlay; tap toggles play / pause, the bar seeks. */
export function VideoPlayer({ src }: { src: string }) {
  const { t } = useTranslation();
  const video = useMedia<HTMLVideoElement>();
  return (
    <div className="group relative mb-1 max-w-[260px] overflow-hidden rounded-lg bg-black" data-testid="message-attachment">
      <video ref={video.ref} src={src} preload="metadata" playsInline onClick={video.toggle} className="max-h-52 w-full cursor-pointer object-contain" />
      <button
        type="button"
        onClick={video.toggle}
        aria-label={video.playing ? t("chat.pause") : t("chat.play")}
        className={cn("absolute inset-0 m-auto flex size-11 items-center justify-center rounded-full bg-black/60 text-white transition-opacity", video.playing && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
      >
        {video.playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5 translate-x-px" aria-hidden="true" />}
      </button>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 px-2 pt-3 pb-1 text-white">
        <SeekBar time={video.time} duration={video.duration} onSeek={video.seek} label={t("chat.mediaVideo")} />
        <span className="shrink-0 text-[10px] tabular-nums">{clock(video.duration - video.time)}</span>
      </div>
    </div>
  );
}
