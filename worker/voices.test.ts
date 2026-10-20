import { describe, expect, it } from "vitest";
import { parseDetections, transcriptLines, voiceLabels, wavSlice, type Detection } from "./voices";

const en = (p = 0.95): Detection => ({ lang: "en", p });
const fr = (p = 0.95): Detection => ({ lang: "fr", p });

describe("voices", () => {
  it("reads whisper -dl logs per file, in processing order", () => {
    const log = [
      "main: processing '/tmp/a.wav' (56000 samples, 3.5 sec), 4 threads, lang = auto ...",
      "whisper_full_with_state: auto-detected language: en (p = 0.969276)",
      "main: processing '/tmp/b.wav' (41600 samples, 2.6 sec) ...",
      "whisper_full_with_state: auto-detected language: fr (p = 0.993953)",
    ].join("\n");
    expect([...parseDetections(log)]).toEqual([
      ["/tmp/a.wav", { lang: "en", p: 0.969276 }],
      ["/tmp/b.wav", { lang: "fr", p: 0.993953 }],
    ]);
  });

  it("labels a cutscene block as content, the creator by the video's language", () => {
    expect(voiceLabels([fr(), en(), en(), en(), fr()], "fr")).toEqual(["creator", "content", "content", "content", "creator"]);
  });

  it("ignores short runs: game commentary heard under the creator during gameplay", () => {
    expect(voiceLabels([fr(), en(0.99), fr(), en(), en(), fr(), en(), en(), en(), en()], "fr")).toEqual([
      "creator", null, "creator", null, null, "creator", "content", "content", "content", "content",
    ]);
  });

  it("never treats a stray language as the content's, and fills undecided lines from agreeing neighbours", () => {
    // zh is a short line misread; null is a line too short to detect.
    expect(voiceLabels([fr(), { lang: "zh", p: 0.72 }, fr(), en(), null, en(), en(0.4), en(), fr(), null, en()], "fr")).toEqual([
      "creator", "creator", "creator", "content", "content", "content", "content", "content", "creator", null, null,
    ]);
  });

  it("groups words into sentences of 12 s at most", () => {
    const words = ["Salut.", "Ça", "va", "?"].map((w, i) => ({ w, start: i, end: i + 0.5 }));
    expect(transcriptLines(words).map((l) => [l.start, l.end, l.words.length])).toEqual([
      [0, 0.5, 1],
      [1, 3.5, 3],
    ]);
  });

  it("cuts a time range out of a 16-bit mono WAV", () => {
    const rate = 16000;
    const samples = rate * 2;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(36 + samples * 2, 4);
    wav.write("WAVEfmt ", 8, "ascii");
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36, "ascii");
    wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(i % 30000, 44 + i * 2);
    const part = wavSlice(wav, 0.5, 1.25);
    expect(part.readUInt32LE(40)).toBe(0.75 * rate * 2);
    expect(part.length).toBe(44 + 0.75 * rate * 2);
    expect(part.readInt16LE(44)).toBe((0.5 * rate) % 30000);
  });
});
