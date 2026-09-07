import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

type Props = {
  onFile: (file: File) => void;
  disabled?: boolean;
};

export function Dropzone({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const takeFile = useCallback(
    (file?: File) => {
      if (!file || disabled) return;
      onFile(file);
    },
    [disabled, onFile],
  );

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    takeFile(event.dataTransfer.files[0]);
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div
      className={`dropzone ${over ? "is-over" : ""} ${disabled ? "is-disabled" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload a photo"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={onKey}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
        hidden
        onChange={(e) => {
          takeFile(e.target.files?.[0]);
          e.currentTarget.value = "";
        }}
      />
      <div className="dropzone-art" aria-hidden="true">
        <svg viewBox="0 0 120 88" fill="none">
          <rect x="8" y="18" width="72" height="52" rx="6" fill="#1a2332" stroke="#e8b86d" strokeOpacity="0.45" />
          <path d="M8 58l18-16 14 12 12-18 28 22" stroke="#7ec8c3" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="28" cy="34" r="5" fill="#e8b86d" fillOpacity="0.7" />
          <path
            d="M86 22c10 6 18 16 18 28 0 14-12 24-22 32"
            stroke="#e8b86d"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="82" cy="22" r="8" fill="#e8b86d" />
          <circle cx="82" cy="22" r="3" fill="#0c1017" />
        </svg>
      </div>
      <p className="dropzone-title">Drop a photo here</p>
      <p className="dropzone-sub">or click to browse — JPEG, PNG, WebP, HEIC</p>
    </div>
  );
}
