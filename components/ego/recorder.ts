// Microphone capture to mono Float32 PCM through the Web Audio API. AudioWorklet where
// available, ScriptProcessor as a guarded fallback. Browser-only.

export type RecorderErrorCode = "unsupported" | "denied" | "failed";

export class RecorderError extends Error {
  constructor(
    public readonly code: RecorderErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface Recording {
  /** Stops capture, releases the microphone and returns the audio. */
  stop(): Promise<{ samples: Float32Array; sampleRate: number }>;
  /** Stops capture and releases the microphone, discarding the audio. */
  cancel(): void;
}

const WORKLET_SOURCE = `
class EgoCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("ego-capture", EgoCapture);
`;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    audioContextCtor() !== undefined
  );
}

/** Rejects if the promise has not settled in `ms`: some iOS audio calls hang instead of failing. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Starts capturing. Rejects with a RecorderError; nothing stays open on failure. */
export async function startRecording(): Promise<Recording> {
  const Ctor = audioContextCtor();
  if (!navigator.mediaDevices?.getUserMedia || !Ctor) {
    throw new RecorderError("unsupported", "Voice input is not supported in this browser.");
  }

  // Create and resume the context synchronously, while the press is still a user gesture.
  // iOS leaves a context created after the permission prompt suspended, and resume() can then hang.
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
  const closeEarly = () => void ctx?.close().catch(() => undefined);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    closeEarly();
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      throw new RecorderError("denied", "Microphone access is blocked.");
    }
    throw new RecorderError("failed", "I could not open the microphone.");
  }

  const chunks: Float32Array[] = [];
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioNode | null = null;
  let mute: GainNode | null = null;
  let workletUrl: string | null = null;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    try {
      if (node) {
        node.disconnect();
        if ("port" in node) (node as AudioWorkletNode).port.onmessage = null;
        if ("onaudioprocess" in node) (node as ScriptProcessorNode).onaudioprocess = null;
      }
      mute?.disconnect();
      source?.disconnect();
    } catch {
      // Already disconnected.
    }
    stream.getTracks().forEach((t) => t.stop());
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    void ctx?.close().catch(() => undefined);
  };

  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") {
      // Never wait forever: a context that will not resume must fail visibly, not hang.
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
      if (ctx.state === "suspended") throw new RecorderError("failed", "The audio engine did not start.");
    }
    source = ctx.createMediaStreamSource(stream);
    let usedWorklet = false;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        await withTimeout(ctx.audioWorklet.addModule(workletUrl), 1500);
        // Safari does not run a node with no path to the destination, so route it through a muted gain.
        const worklet = new AudioWorkletNode(ctx, "ego-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
        worklet.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);
        mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(worklet);
        worklet.connect(mute);
        mute.connect(ctx.destination);
        node = worklet;
        usedWorklet = true;
      } catch {
        usedWorklet = false; // fall back to ScriptProcessor
      }
    }
    if (!usedWorklet) {
      if (typeof ctx.createScriptProcessor !== "function") {
        throw new RecorderError("unsupported", "Voice input is not supported in this browser.");
      }
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(proc);
      proc.connect(ctx.destination); // required for the callback to fire; output is silent
      node = proc;
    }
  } catch (err) {
    release();
    throw err instanceof RecorderError ? err : new RecorderError("failed", "I could not start recording.");
  }

  const sampleRate = ctx!.sampleRate;
  return {
    async stop() {
      // Give the worklet a beat to flush its last message before tearing down.
      await new Promise((r) => setTimeout(r, 30));
      release();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const samples = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        samples.set(c, at);
        at += c.length;
      }
      return { samples, sampleRate };
    },
    cancel: release,
  };
}
