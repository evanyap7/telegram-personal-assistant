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

/** Starts capturing. Rejects with a RecorderError; nothing stays open on failure. */
export async function startRecording(): Promise<Recording> {
  const Ctor = audioContextCtor();
  if (!navigator.mediaDevices?.getUserMedia || !Ctor) {
    throw new RecorderError("unsupported", "Voice input is not supported in this browser.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      throw new RecorderError("denied", "Microphone access is blocked.");
    }
    throw new RecorderError("failed", "I could not open the microphone.");
  }

  const chunks: Float32Array[] = [];
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioNode | null = null;
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
      source?.disconnect();
    } catch {
      // Already disconnected.
    }
    stream.getTracks().forEach((t) => t.stop());
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    void ctx?.close().catch(() => undefined);
  };

  try {
    ctx = new Ctor();
    if (ctx.state === "suspended") await ctx.resume();
    source = ctx.createMediaStreamSource(stream);
    let usedWorklet = false;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(workletUrl);
        const worklet = new AudioWorkletNode(ctx, "ego-capture", { numberOfOutputs: 0 });
        worklet.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);
        source.connect(worklet);
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

  const sampleRate = ctx.sampleRate;
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
