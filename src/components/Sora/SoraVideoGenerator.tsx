import React, { useState, useCallback, useRef, useEffect } from "react";
import JSZip from "jszip";

// ─── Types ───────────────────────────────────────────────────────────────────

interface VideoSlot {
  taskId: string | null;
  status: "idle" | "generating" | "polling" | "success" | "failed";
  videoUrl: string | null;
  progress: number;
  error: string | null;
}

interface Segment {
  id: string;
  prompt: string;
  duration: "10" | "15";
  imageUrl: string;
  videos: VideoSlot[];
}

const LOOPS_PER_SEGMENT = 3;

const makeEmptyVideoSlot = (): VideoSlot => ({
  taskId: null,
  status: "idle",
  videoUrl: null,
  progress: 0,
  error: null,
});

const makeSegment = (prompt: string, duration: "10" | "15"): Segment => ({
  id: crypto.randomUUID?.() || String(Date.now() + Math.random()),
  prompt,
  duration,
  imageUrl: "",
  videos: Array.from({ length: LOOPS_PER_SEGMENT }, makeEmptyVideoSlot),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getVideoFilename = (
  title: string,
  segIdx: number,
  loopIdx: number
): string => {
  const prefix = title.trim() || "Video";
  const seg = `S${segIdx + 1}`;
  if (loopIdx === 0) return `${prefix}_${seg}.mp4`;
  return `${prefix}_${seg}_${loopIdx}.mp4`;
};

const LS_KEY_KIE = "sora_kie_api_key";
const LS_KEY_OPENAI = "sora_openai_api_key";

function loadFromLS(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) || "";
}

// ─── Component ───────────────────────────────────────────────────────────────

const SoraVideoGenerator: React.FC = () => {
  // --- Settings ---
  const [title, setTitle] = useState("");
  const [kieApiKey, setKieApiKey] = useState(() => loadFromLS(LS_KEY_KIE));
  const [openaiApiKey, setOpenaiApiKey] = useState(() =>
    loadFromLS(LS_KEY_OPENAI)
  );
  const [showKeys, setShowKeys] = useState(false);

  // --- Defaults ---
  const [defaultDuration, setDefaultDuration] = useState<"10" | "15">("10");
  const [aspectRatio, setAspectRatio] = useState("landscape");
  const [quality, setQuality] = useState<"standard" | "high">("standard");
  const [removeWatermark, setRemoveWatermark] = useState(true);

  // --- Input ---
  const [mode, setMode] = useState<"script" | "segments">("segments");
  const [inputText, setInputText] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isConverting, setIsConverting] = useState(false);

  // --- Segments ---
  const [segments, setSegments] = useState<Segment[]>([]);

  // --- Polling refs ---
  const pollingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Persist API keys to localStorage
  useEffect(() => {
    localStorage.setItem(LS_KEY_KIE, kieApiKey);
  }, [kieApiKey]);
  useEffect(() => {
    localStorage.setItem(LS_KEY_OPENAI, openaiApiKey);
  }, [openaiApiKey]);

  // Cleanup polling timers on unmount
  useEffect(() => {
    return () => {
      pollingTimers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  // ─── Segment management ─────────────────────────────────────────────

  const loadSegmentsFromText = useCallback(() => {
    const lines = inputText
      .split(/\n{2,}|\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    setSegments(lines.map((line) => makeSegment(line, defaultDuration)));
  }, [inputText, defaultDuration]);

  const convertScriptToSegments = useCallback(async () => {
    if (!inputText.trim()) return;
    if (!openaiApiKey && !process.env.NEXT_PUBLIC_OPENAI_KEY) {
      alert("Please enter your OpenAI API key to convert scripts.");
      return;
    }
    setIsConverting(true);
    try {
      const res = await fetch("/api/sora/script-to-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: inputText,
          systemPrompt: systemPrompt || undefined,
          apiKey: openaiApiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Conversion failed");
      const segs: string[] = data.segments || [];
      setSegments(segs.map((s) => makeSegment(s, defaultDuration)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setIsConverting(false);
    }
  }, [inputText, systemPrompt, openaiApiKey, defaultDuration]);

  const updateSegment = useCallback(
    (idx: number, patch: Partial<Segment>) => {
      setSegments((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
      );
    },
    []
  );

  const updateVideoSlot = useCallback(
    (segIdx: number, vidIdx: number, patch: Partial<VideoSlot>) => {
      setSegments((prev) =>
        prev.map((s, si) =>
          si === segIdx
            ? {
                ...s,
                videos: s.videos.map((v, vi) =>
                  vi === vidIdx ? { ...v, ...patch } : v
                ),
              }
            : s
        )
      );
    },
    []
  );

  const addSegment = useCallback(() => {
    setSegments((prev) => [...prev, makeSegment("", defaultDuration)]);
  }, [defaultDuration]);

  const removeSegment = useCallback((idx: number) => {
    setSegments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ─── Video generation ───────────────────────────────────────────────

  const pollTaskStatus = useCallback(
    (taskId: string, segIdx: number, vidIdx: number) => {
      const poll = async () => {
        try {
          const res = await fetch("/api/sora/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: kieApiKey, taskId }),
          });
          const data = await res.json();

          const record = data.data || data;
          const state = record.state || record.status;

          if (state === "success") {
            let videoUrl = "";
            try {
              const result =
                typeof record.resultJson === "string"
                  ? JSON.parse(record.resultJson)
                  : record.resultJson;
              videoUrl = result?.resultUrls?.[0] || result?.url || "";
            } catch {
              videoUrl = "";
            }
            updateVideoSlot(segIdx, vidIdx, {
              status: "success",
              videoUrl,
              progress: 100,
            });
            pollingTimers.current.delete(`${segIdx}-${vidIdx}`);
            return;
          }

          if (state === "fail") {
            updateVideoSlot(segIdx, vidIdx, {
              status: "failed",
              error: record.failMsg || "Generation failed",
            });
            pollingTimers.current.delete(`${segIdx}-${vidIdx}`);
            return;
          }

          // Still processing
          updateVideoSlot(segIdx, vidIdx, {
            status: "polling",
            progress: record.progress || 0,
          });
          const timer = setTimeout(poll, 6000);
          pollingTimers.current.set(`${segIdx}-${vidIdx}`, timer);
        } catch {
          // Retry on network error
          const timer = setTimeout(poll, 10000);
          pollingTimers.current.set(`${segIdx}-${vidIdx}`, timer);
        }
      };
      poll();
    },
    [kieApiKey, updateVideoSlot]
  );

  const generateVideo = useCallback(
    async (segIdx: number, vidIdx: number) => {
      const seg = segments[segIdx];
      if (!seg) return;
      if (!kieApiKey) {
        alert("Please enter your Kie AI API key.");
        return;
      }

      updateVideoSlot(segIdx, vidIdx, {
        status: "generating",
        taskId: null,
        videoUrl: null,
        progress: 0,
        error: null,
      });

      try {
        const res = await fetch("/api/sora/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: kieApiKey,
            prompt: seg.prompt,
            aspectRatio,
            nFrames: seg.duration,
            quality,
            removeWatermark,
            imageUrls: seg.imageUrl ? [seg.imageUrl] : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create task");

        updateVideoSlot(segIdx, vidIdx, {
          status: "polling",
          taskId: data.taskId,
        });
        pollTaskStatus(data.taskId, segIdx, vidIdx);
      } catch (err: unknown) {
        updateVideoSlot(segIdx, vidIdx, {
          status: "failed",
          error: err instanceof Error ? err.message : "Generation failed",
        });
      }
    },
    [
      segments,
      kieApiKey,
      aspectRatio,
      quality,
      removeWatermark,
      updateVideoSlot,
      pollTaskStatus,
    ]
  );

  const generateSegment = useCallback(
    (segIdx: number) => {
      for (let v = 0; v < LOOPS_PER_SEGMENT; v++) {
        generateVideo(segIdx, v);
      }
    },
    [generateVideo]
  );

  const generateAll = useCallback(() => {
    segments.forEach((_, idx) => generateSegment(idx));
  }, [segments, generateSegment]);

  // ─── Downloads ──────────────────────────────────────────────────────

  const downloadSingleVideo = useCallback(
    async (segIdx: number, vidIdx: number) => {
      const seg = segments[segIdx];
      const vid = seg?.videos[vidIdx];
      if (!vid?.videoUrl) return;

      const filename = getVideoFilename(title, segIdx, vidIdx);
      try {
        const res = await fetch(vid.videoUrl);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        window.open(vid.videoUrl, "_blank");
      }
    },
    [segments, title]
  );

  const downloadAllAsZip = useCallback(async () => {
    const zip = new JSZip();
    const fetchPromises: Promise<void>[] = [];

    segments.forEach((seg, segIdx) => {
      seg.videos.forEach((vid, vidIdx) => {
        if (vid.videoUrl) {
          const filename = getVideoFilename(title, segIdx, vidIdx);
          fetchPromises.push(
            fetch(vid.videoUrl)
              .then((r) => r.blob())
              .then((blob) => {
                zip.file(filename, blob);
              })
              .catch(() => {
                /* skip failed downloads */
              })
          );
        }
      });
    });

    if (fetchPromises.length === 0) {
      alert("No videos available to download.");
      return;
    }

    await Promise.all(fetchPromises);
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.trim() || "Videos"}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [segments, title]);

  // ─── Upload system prompt file ──────────────────────────────────────

  const handleSystemPromptFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSystemPrompt((ev.target?.result as string) || "");
      };
      reader.readAsText(file);
    },
    []
  );

  // ─── Computed ──────────────────────────────────────────────────────

  const totalVideos = segments.reduce(
    (acc, s) => acc + s.videos.filter((v) => v.status === "success").length,
    0
  );
  const totalGenerating = segments.reduce(
    (acc, s) =>
      acc +
      s.videos.filter(
        (v) => v.status === "generating" || v.status === "polling"
      ).length,
    0
  );

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-base-200 p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <h1 className="mb-6 text-3xl font-bold">Sora Video Generator</h1>

        {/* ─── Settings Card ─────────────────────────────────────────── */}
        <div className="daisy-card mb-6 bg-base-100 shadow">
          <div className="daisy-card-body">
            <h2 className="daisy-card-title text-lg">Settings</h2>

            {/* Title & API Keys */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="daisy-label">
                  <span className="daisy-label-text font-semibold">
                    Project Title
                  </span>
                </label>
                <input
                  type="text"
                  className="daisy-input daisy-input-bordered w-full"
                  placeholder="My Video Project"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="daisy-label">
                  <span className="daisy-label-text font-semibold">
                    Kie AI API Key
                  </span>
                  <button
                    className="daisy-label-text-alt daisy-btn daisy-btn-ghost daisy-btn-xs"
                    onClick={() => setShowKeys((v) => !v)}
                  >
                    {showKeys ? "Hide" : "Show"}
                  </button>
                </label>
                <input
                  type={showKeys ? "text" : "password"}
                  className="daisy-input daisy-input-bordered w-full"
                  placeholder="Enter your Kie AI API key"
                  value={kieApiKey}
                  onChange={(e) => setKieApiKey(e.target.value)}
                />
              </div>
            </div>

            {/* OpenAI Key (for script conversion) */}
            <div>
              <label className="daisy-label">
                <span className="daisy-label-text font-semibold">
                  OpenAI API Key{" "}
                  <span className="font-normal opacity-60">
                    (for script → segments conversion)
                  </span>
                </span>
              </label>
              <input
                type={showKeys ? "text" : "password"}
                className="daisy-input daisy-input-bordered w-full"
                placeholder="sk-... (optional, only needed for script conversion)"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
              />
            </div>

            {/* Generation defaults */}
            <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <label className="daisy-label">
                  <span className="daisy-label-text font-semibold">
                    Default Duration
                  </span>
                </label>
                <select
                  className="daisy-select daisy-select-bordered w-full"
                  value={defaultDuration}
                  onChange={(e) =>
                    setDefaultDuration(e.target.value as "10" | "15")
                  }
                >
                  <option value="10">10 seconds</option>
                  <option value="15">15 seconds</option>
                </select>
              </div>
              <div>
                <label className="daisy-label">
                  <span className="daisy-label-text font-semibold">
                    Aspect Ratio
                  </span>
                </label>
                <select
                  className="daisy-select daisy-select-bordered w-full"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                >
                  <option value="landscape">Landscape (16:9)</option>
                  <option value="portrait">Portrait (9:16)</option>
                </select>
              </div>
              <div>
                <label className="daisy-label">
                  <span className="daisy-label-text font-semibold">
                    Quality
                  </span>
                </label>
                <select
                  className="daisy-select daisy-select-bordered w-full"
                  value={quality}
                  onChange={(e) =>
                    setQuality(e.target.value as "standard" | "high")
                  }
                >
                  <option value="standard">Standard (720p)</option>
                  <option value="high">HD (1080p)</option>
                </select>
              </div>
              <div>
                <label className="daisy-label">
                  <span className="daisy-label-text font-semibold">
                    Watermark
                  </span>
                </label>
                <label className="daisy-label cursor-pointer justify-start gap-3">
                  <input
                    type="checkbox"
                    className="daisy-toggle daisy-toggle-primary"
                    checked={removeWatermark}
                    onChange={(e) => setRemoveWatermark(e.target.checked)}
                  />
                  <span className="daisy-label-text">
                    {removeWatermark ? "Remove watermark" : "Keep watermark"}
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Input Card ────────────────────────────────────────────── */}
        <div className="daisy-card mb-6 bg-base-100 shadow">
          <div className="daisy-card-body">
            <div className="flex items-center justify-between">
              <h2 className="daisy-card-title text-lg">Input</h2>
              <div className="daisy-tabs daisy-tabs-boxed">
                <button
                  className={`daisy-tab ${
                    mode === "segments" ? "daisy-tab-active" : ""
                  }`}
                  onClick={() => setMode("segments")}
                >
                  Segment Prompts
                </button>
                <button
                  className={`daisy-tab ${
                    mode === "script" ? "daisy-tab-active" : ""
                  }`}
                  onClick={() => setMode("script")}
                >
                  Script
                </button>
              </div>
            </div>

            {/* Textarea */}
            <textarea
              className="daisy-textarea daisy-textarea-bordered mt-3 h-48 w-full font-mono text-sm"
              placeholder={
                mode === "segments"
                  ? "Paste your segment prompts here, one per line or separated by blank lines...\n\nExample:\nA wide shot of a sunset over the ocean, waves gently crashing...\nA close-up of a woman's face as she looks out the window..."
                  : "Paste your full script here. It will be converted into segment prompts using AI..."
              }
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />

            {/* Script mode: System prompt */}
            {mode === "script" && (
              <div className="mt-3">
                <label className="daisy-label">
                  <span className="daisy-label-text font-semibold">
                    System Prompt{" "}
                    <span className="font-normal opacity-60">
                      (optional, for script → segments conversion)
                    </span>
                  </span>
                  <label className="daisy-btn daisy-btn-ghost daisy-btn-xs">
                    Upload File
                    <input
                      type="file"
                      accept=".txt,.md"
                      className="hidden"
                      onChange={handleSystemPromptFile}
                    />
                  </label>
                </label>
                <textarea
                  className="daisy-textarea daisy-textarea-bordered h-32 w-full font-mono text-sm"
                  placeholder="Custom system prompt for converting your script into segment prompts... (leave empty for default)"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              {mode === "segments" ? (
                <button
                  className="daisy-btn daisy-btn-primary"
                  onClick={loadSegmentsFromText}
                  disabled={!inputText.trim()}
                >
                  Load Segments
                </button>
              ) : (
                <button
                  className={`daisy-btn daisy-btn-primary ${
                    isConverting ? "daisy-loading" : ""
                  }`}
                  onClick={convertScriptToSegments}
                  disabled={!inputText.trim() || isConverting}
                >
                  {isConverting ? "Converting..." : "Convert Script to Segments"}
                </button>
              )}
              <button
                className="daisy-btn daisy-btn-secondary"
                onClick={generateAll}
                disabled={
                  segments.length === 0 || !kieApiKey || totalGenerating > 0
                }
              >
                {totalGenerating > 0
                  ? `Generating (${totalGenerating})...`
                  : "Generate All"}
              </button>
              <button
                className="daisy-btn daisy-btn-accent"
                onClick={downloadAllAsZip}
                disabled={totalVideos === 0}
              >
                Download All ({totalVideos} videos)
              </button>
              <button
                className="daisy-btn daisy-btn-ghost"
                onClick={addSegment}
              >
                + Add Segment
              </button>
            </div>
          </div>
        </div>

        {/* ─── Segments ──────────────────────────────────────────────── */}
        {segments.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">
              Segments ({segments.length})
            </h2>

            {segments.map((seg, segIdx) => (
              <div
                key={seg.id}
                className="daisy-card bg-base-100 shadow"
              >
                <div className="daisy-card-body">
                  {/* Segment header */}
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-primary">
                      S{segIdx + 1}
                    </h3>
                    <div className="flex items-center gap-2">
                      <select
                        className="daisy-select daisy-select-bordered daisy-select-sm"
                        value={seg.duration}
                        onChange={(e) =>
                          updateSegment(segIdx, {
                            duration: e.target.value as "10" | "15",
                          })
                        }
                      >
                        <option value="10">10s</option>
                        <option value="15">15s</option>
                      </select>
                      <button
                        className="daisy-btn daisy-btn-primary daisy-btn-sm"
                        onClick={() => generateSegment(segIdx)}
                        disabled={!seg.prompt.trim() || !kieApiKey}
                      >
                        Generate 3x
                      </button>
                      <button
                        className="daisy-btn daisy-btn-ghost daisy-btn-sm text-error"
                        onClick={() => removeSegment(segIdx)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Prompt */}
                  <textarea
                    className="daisy-textarea daisy-textarea-bordered mt-2 w-full text-sm"
                    rows={3}
                    placeholder="Describe the visual scene for this segment..."
                    value={seg.prompt}
                    onChange={(e) =>
                      updateSegment(segIdx, { prompt: e.target.value })
                    }
                  />

                  {/* Optional image URL for image-to-video */}
                  <div className="mt-1">
                    <input
                      type="text"
                      className="daisy-input daisy-input-bordered daisy-input-sm w-full"
                      placeholder="Image URL (optional, for image-to-video)"
                      value={seg.imageUrl}
                      onChange={(e) =>
                        updateSegment(segIdx, { imageUrl: e.target.value })
                      }
                    />
                  </div>

                  {/* Video slots */}
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {seg.videos.map((vid, vidIdx) => (
                      <div
                        key={vidIdx}
                        className="daisy-card daisy-card-compact border bg-base-200"
                      >
                        <div className="daisy-card-body items-center">
                          <span className="mb-1 text-xs font-semibold opacity-60">
                            {getVideoFilename(title, segIdx, vidIdx)}
                          </span>

                          {/* Video display area */}
                          {vid.status === "idle" && (
                            <div className="flex h-36 w-full items-center justify-center rounded bg-base-300 text-sm opacity-50">
                              Not generated
                            </div>
                          )}

                          {(vid.status === "generating" ||
                            vid.status === "polling") && (
                            <div className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded bg-base-300">
                              <span className="text-sm">
                                {vid.status === "generating"
                                  ? "Submitting..."
                                  : `Generating... ${vid.progress}%`}
                              </span>
                              <progress
                                className="daisy-progress daisy-progress-primary w-3/4"
                                value={vid.progress}
                                max={100}
                              />
                            </div>
                          )}

                          {vid.status === "success" && vid.videoUrl && (
                            <video
                              className="h-36 w-full rounded object-cover"
                              src={vid.videoUrl}
                              controls
                              preload="metadata"
                            />
                          )}

                          {vid.status === "failed" && (
                            <div className="flex h-36 w-full items-center justify-center rounded bg-error/10 px-2 text-center text-sm text-error">
                              {vid.error || "Failed"}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex gap-1">
                            <button
                              className="daisy-btn daisy-btn-ghost daisy-btn-xs"
                              onClick={() => generateVideo(segIdx, vidIdx)}
                              disabled={
                                !seg.prompt.trim() ||
                                !kieApiKey ||
                                vid.status === "generating" ||
                                vid.status === "polling"
                              }
                            >
                              {vid.status === "success"
                                ? "Regenerate"
                                : "Generate"}
                            </button>
                            {vid.status === "success" && vid.videoUrl && (
                              <button
                                className="daisy-btn daisy-btn-ghost daisy-btn-xs"
                                onClick={() =>
                                  downloadSingleVideo(segIdx, vidIdx)
                                }
                              >
                                Download
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {segments.length === 0 && (
          <div className="mt-12 text-center opacity-50">
            <p className="text-lg">No segments yet.</p>
            <p className="text-sm">
              Paste segment prompts or a script above to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SoraVideoGenerator;
