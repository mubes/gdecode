// ---------------------------------------------------------------------------
// DropZone — drag/drop (and click-to-browse) ingest. On drop it reads the file
// text, stores it, spins up the parse worker over Comlink, and pushes the
// resulting GcodeDoc into the store. Parse errors surface as a transient toast.
//
// Not wired into App here — App imports and places <DropZone /> itself.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileRejection } from 'react-dropzone';
import { wrap } from '../workers/comlink';
import type { Remote } from '../workers/comlink';
import { useStore } from '../store';
import type { GcodeDoc } from '../types';
import type { ParseWorkerApi } from '../parse/parse.worker';

const ACCEPT_EXT = ['.gcode', '.nc', '.tap', '.ngc', '.cnc', '.g'];

export function DropZone() {
  const beginParse = useStore((s) => s.beginParse);
  const addModel = useStore((s) => s.addModel);
  const setError = useStore((s) => s.setError);
  const status = useStore((s) => s.status);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazily-created worker + Comlink proxy, kept for the component lifetime.
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Remote<ParseWorkerApi> | null>(null);

  const getApi = useCallback((): Remote<ParseWorkerApi> => {
    if (!apiRef.current) {
      const worker = new Worker(new URL('../parse/parse.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      apiRef.current = wrap<ParseWorkerApi>(worker);
    }
    return apiRef.current;
  }, []);

  useEffect(() => {
    return () => {
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const onDrop = useCallback(
    async (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const msg = `Unsupported file: ${rejected[0].file.name}. Accepts ${ACCEPT_EXT.join(', ')}`;
        setError(msg);
        showToast(msg);
        return;
      }
      // Append each dropped file as a model (multi-model build plate).
      for (const file of accepted) {
        try {
          const text = await file.text();
          beginParse(file.name);
          const api = getApi();
          const doc: GcodeDoc = await api.parse(text);
          // Once a mode is established by the first file, refuse files of the
          // other mode — additive and subtractive parts don't share a scene.
          const existing = useStore.getState().models;
          if (existing.length && existing[0].doc.mode !== doc.mode) {
            const msg = `${file.name} is ${doc.mode}, but the current view is ${existing[0].doc.mode}. Clear loaded models to switch modes.`;
            setError(msg);
            showToast(msg);
            continue;
          }
          addModel(file.name, doc);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Failed to parse ${file.name}: ${msg}`);
          showToast(`Failed to parse ${file.name}: ${msg}`);
        }
      }
    },
    [getApi, addModel, setError, beginParse, showToast],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: true,
    noClick: status !== 'idle', // full-screen overlay is clickable; small chip uses its own button
    accept: {
      'text/plain': ACCEPT_EXT,
      'application/octet-stream': ACCEPT_EXT,
    },
  });

  const parsing = status === 'parsing';
  const idle = status === 'idle';

  return (
    <>
      {/* Full-screen drop overlay, shown only before a file is loaded. */}
      {idle && (
        <div
          {...getRootProps()}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            zIndex: 20,
            cursor: 'pointer',
            background: isDragActive ? 'rgba(60,90,140,0.35)' : 'rgba(20,20,26,0.55)',
            border: isDragActive ? '2px dashed #6da7ff' : '2px dashed #444',
            color: '#ddd',
            transition: 'background 120ms ease, border-color 120ms ease',
            textAlign: 'center',
            userSelect: 'none',
          }}
        >
          <input {...getInputProps()} />
          <div style={{ fontSize: 22, fontWeight: 600 }}>Drop a G-code file</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            or click to browse · {ACCEPT_EXT.join('  ')}
          </div>
        </div>
      )}

      {/* Persistent "Open" affordance in the bottom-left corner, once something
          is loaded. (Bottom-left keeps it clear of the control panel pulldown.)
          The old "or drop more" hint is gone — drops only land on this small
          chip, so the button is the reliable way to add a file. */}
      {!idle && (
        <div
          style={{
            position: 'fixed',
            bottom: 12,
            left: 12,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => open()}
            style={{
              background: '#3a5a8c',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            Open…
          </button>
          {parsing && <span style={{ opacity: 0.75, fontSize: 12, color: '#ccc' }}>Parsing…</span>}
        </div>
      )}

      {/* Parsing spinner overlay. */}
      {parsing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 19,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            color: '#bcd',
            fontSize: 16,
            background: 'rgba(20,20,26,0.35)',
          }}
        >
          Parsing…
        </div>
      )}

      {/* Transient error toast. */}
      {toast && (
        <div
          role="alert"
          onClick={() => setToast(null)}
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            maxWidth: '80vw',
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(120,30,30,0.95)',
            border: '1px solid #d66',
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
