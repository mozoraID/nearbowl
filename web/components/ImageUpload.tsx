"use client";

import { BLOB_TOKEN_MISSING, coinImagePath, imageFileProblem, safeCoinImage } from "@/lib/image";
import { prepareCoinImage } from "@/lib/prepare-image";
import { upload } from "@vercel/blob/client";
import { useEffect, useId, useRef, useState } from "react";

export type CoinImageField = {
  url: string;
  previewUrl: string | null;
  error: string | null;
  busy: boolean;
};

const EMPTY: CoinImageField = { url: "", previewUrl: null, error: null, busy: false };

function failureMessage(err: unknown, configured: boolean | "unknown" | null): string {
  if (configured === false) return BLOB_TOKEN_MISSING;
  if (err instanceof Error && err.name === "AbortError") return "";
  const text = err instanceof Error ? err.message : "";
  if (/BLOB_READ_WRITE_TOKEN/i.test(text)) return BLOB_TOKEN_MISSING;
  if (text.includes("retrieve the client token")) {
    return "The picture did not upload. If this server has no BLOB_READ_WRITE_TOKEN, set it and restart. Remove the picture to launch without one.";
  }
  if (text && text.length < 180 && !text.includes("Failed to")) return text;
  return "The picture did not upload. Try again.";
}

export function ImageUpload({ onChange }: { onChange: (field: CoinImageField) => void }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [configured, setConfigured] = useState<boolean | "unknown" | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "uploading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    let stop = false;
    fetch("/api/upload")
      .then((response) => response.json() as Promise<{ configured?: boolean }>)
      .then((body) => {
        if (!stop) setConfigured(body.configured === true);
      })
      .catch(() => {
        if (!stop) setConfigured("unknown");
      });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      generation.current += 1;
      abortRef.current?.abort();
      if (previewRef.current?.startsWith("blob:")) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  function rememberPreview(next: string | null) {
    if (previewRef.current && previewRef.current !== next && previewRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(previewRef.current);
    }
    previewRef.current = next;
    setPreviewUrl(next);
  }

  function publish(field: CoinImageField) {
    onChange(field);
  }

  function clear() {
    generation.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    rememberPreview(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setDrag(false);
    if (inputRef.current) inputRef.current.value = "";
    publish(EMPTY);
  }

  async function accept(file: File) {
    const problem = imageFileProblem(file);
    if (problem) {
      generation.current += 1;
      abortRef.current?.abort();
      rememberPreview(null);
      setPhase("error");
      setProgress(0);
      setError(problem);
      publish({ ...EMPTY, error: problem });
      return;
    }
    if (configured === false) {
      setPhase("error");
      setError(BLOB_TOKEN_MISSING);
      publish({ ...EMPTY, error: BLOB_TOKEN_MISSING });
      return;
    }

    const id = generation.current + 1;
    generation.current = id;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const local = URL.createObjectURL(file);
    rememberPreview(local);
    setError(null);
    setPhase("preparing");
    setProgress(0);
    publish({ url: "", previewUrl: local, error: null, busy: true });

    try {
      const prepared = await prepareCoinImage(file);
      if (id !== generation.current) return;
      let shown = local;
      if (prepared !== file) {
        shown = URL.createObjectURL(prepared);
        rememberPreview(shown);
        publish({ url: "", previewUrl: shown, error: null, busy: true });
      }
      setPhase("uploading");
      const blob = await upload(coinImagePath(prepared.type || file.type), prepared, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: prepared.type || file.type,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          if (id === generation.current) setProgress(Math.max(0, Math.min(100, Math.round(percentage))));
        },
      });
      if (id !== generation.current) return;
      const safe = safeCoinImage(blob.url);
      if (!safe) {
        throw new Error("The stored picture link is longer than 200 characters, which is the factory limit.");
      }
      setPhase("ready");
      setProgress(100);
      setError(null);
      publish({ url: safe, previewUrl: shown, error: null, busy: false });
    } catch (err) {
      if (id !== generation.current || controller.signal.aborted) return;
      const message = failureMessage(err, configured);
      rememberPreview(null);
      setPhase("error");
      setProgress(0);
      setError(message);
      publish({ ...EMPTY, error: message });
    }
  }

  const busy = phase === "preparing" || phase === "uploading";
  const unavailable = configured === false;
  const status =
    phase === "preparing" ? "Preparing picture…" : phase === "uploading" ? `Uploading ${progress}%…` : phase === "ready" ? "Picture ready." : null;

  return (
    <div className="upload-field">
      <label className="upload-title" htmlFor={inputId}>
        Picture <span className="hint">optional</span>
      </label>
      <div
        className={`upload${drag ? " is-drag" : ""}${previewUrl ? " is-ready" : ""}${phase === "preparing" ? " is-preparing" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!unavailable) setDrag(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!unavailable) setDrag(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDrag(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDrag(false);
          if (unavailable || busy) return;
          const file = event.dataTransfer.files?.[0];
          if (file) void accept(file);
        }}
      >
        {previewUrl ? (
          // Local object URL or the just-uploaded https URL. Failures fall back to the empty prompt.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="upload-thumb" src={previewUrl} alt="Selected coin picture" draggable={false} />
        ) : (
          <p className="upload-copy">
            {unavailable ? "Picture upload is unavailable" : configured === null ? "Checking picture upload…" : "Tap to choose"}
            <span>{unavailable ? "Launch still works without one." : "or drop a picture here"}</span>
          </p>
        )}
        {busy ? (
          <div
            className="upload-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase === "preparing" ? 0 : progress}
            aria-label={phase === "preparing" ? "Preparing picture" : "Uploading picture"}
          >
            <span style={{ width: phase === "preparing" ? "40%" : `${progress}%` }} />
          </div>
        ) : null}
        {status ? <p className="hint">{status}</p> : null}
        {previewUrl || phase === "error" ? (
          <div className="upload-actions">
            <button type="button" className="ghost" disabled={busy || unavailable} onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            <button type="button" className="ghost" onClick={clear}>
              Remove
            </button>
          </div>
        ) : null}
        <input
          id={inputId}
          ref={inputRef}
          className="upload-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
          disabled={unavailable || busy || configured === null}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void accept(file);
          }}
        />
      </div>
      {error ? (
        <span className="hint warn" id={`${inputId}-error`} role="alert">
          {error}
        </span>
      ) : unavailable ? (
        <span className="hint warn" role="status">
          {BLOB_TOKEN_MISSING}
        </span>
      ) : (
        <span className="hint">PNG, JPEG, WebP, or GIF, up to 2 MB. Large pictures are resized. Leave this empty to keep the pet.</span>
      )}
    </div>
  );
}
