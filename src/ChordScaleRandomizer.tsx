import React, { useState, useEffect, useRef, useCallback } from "react";

type Direction = "ABOVE" | "BELOW";
type Mode = "major" | "minor";

interface ScaleDegree {
  degree: number;
  direction?: Direction;
}

const KEYS = [
  "C",
  "C#/Db",
  "D",
  "D#/Eb",
  "E",
  "F",
  "F#/Gb",
  "G",
  "G#/Ab",
  "A",
  "A#/Bb",
  "B",
];

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const ChordScaleRandomizer: React.FC = () => {
  const [currentScaleDegree, setCurrentScaleDegree] = useState<ScaleDegree>({
    degree: 1,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [interval, setInterval] = useState(2.0);
  const [selectedKey, setSelectedKey] = useState("C");
  const [mode, setMode] = useState<Mode>("major");
  const [volume, setVolume] = useState(0.3);
  const [isMuted, setIsMuted] = useState(false);
  const [lastCombination, setLastCombination] = useState<ScaleDegree | null>(
    null
  );
  const [detectedNote, setDetectedNote] = useState<string>("");
  const [noteStatus, setNoteStatus] = useState<
    "pending" | "correct" | "incorrect"
  >("pending");
  const [hasFoundCorrect, setHasFoundCorrect] = useState(false);
  const [results, setResults] = useState<boolean[]>([]); // true = correct, false = incorrect
  const hasDetectedFirstNoteRef = useRef(false);
  const everFoundCorrectForCurrentDegree = useRef(false);

  // Duration-based note detection to avoid false positives from noise
  const currentDetectedNoteRef = useRef<string | null>(null);
  const noteDetectionStartTimeRef = useRef<number | null>(null);
  const DETECTION_DURATION_MS = 150; // Note must be held for 500ms to register

  const audioContext = useRef<AudioContext | null>(null);
  const intervalId = useRef<number | null>(null);
  const currentOscillators = useRef<OscillatorNode[]>([]);
  const lastCombinationRef = useRef<ScaleDegree | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const pitchDetectionId = useRef<number | null>(null);

  useEffect(() => {
    audioContext.current = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    return () => {
      if (audioContext.current) {
        audioContext.current.close();
      }
    };
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault(); // Prevent page scrolling

        // Toggle play state
        setIsPlaying((prev) => {
          if (!prev) {
            // Starting - reset all detection and results
            setResults([]);
            hasDetectedFirstNoteRef.current = false;
            everFoundCorrectForCurrentDegree.current = false;
            isFirstScaleDegree.current = true;
            currentDetectedNoteRef.current = null;
            noteDetectionStartTimeRef.current = null;
            setHasFoundCorrect(false);
            setDetectedNote("");
            setNoteStatus("pending");
          }
          return !prev;
        });
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, []);

  const getExpectedNote = (
    keyName: string,
    scaleDegree: number,
    mode: Mode
  ): string => {
    const keyIndex = KEYS.findIndex((key) => key === keyName);
    const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
    const minorIntervals = [0, 2, 3, 5, 7, 8, 10];
    const intervals = mode === "major" ? majorIntervals : minorIntervals;

    const noteIndex = (keyIndex + intervals[scaleDegree - 1]) % 12;
    const expectedNote = NOTE_NAMES[noteIndex];

    return expectedNote;
  };

  const getFrequency = (keyName: string, mode: Mode): number[] => {
    const keyIndex = KEYS.findIndex((key) => key === keyName);
    const baseFrequency = 261.63; // C4
    const semitoneRatio = Math.pow(2, 1 / 12);

    // Always play the root chord of the selected key
    const rootFreq = baseFrequency * Math.pow(semitoneRatio, keyIndex);

    if (mode === "major") {
      // Major triad: root, major third, perfect fifth
      const thirdFreq = baseFrequency * Math.pow(semitoneRatio, keyIndex + 4); // Major third (4 semitones)
      const fifthFreq = baseFrequency * Math.pow(semitoneRatio, keyIndex + 7); // Perfect fifth (7 semitones)
      return [rootFreq, thirdFreq, fifthFreq];
    } else {
      // Minor triad: root, minor third, perfect fifth
      const thirdFreq = baseFrequency * Math.pow(semitoneRatio, keyIndex + 3); // Minor third (3 semitones)
      const fifthFreq = baseFrequency * Math.pow(semitoneRatio, keyIndex + 7); // Perfect fifth (7 semitones)
      return [rootFreq, thirdFreq, fifthFreq];
    }
  };

  const playChord = (scaleDegree: ScaleDegree) => {
    if (!audioContext.current || isMuted) return;

    // Stop any currently playing oscillators
    currentOscillators.current.forEach((osc) => {
      try {
        osc.stop();
      } catch (e) {
        // Oscillator may already be stopped
      }
    });
    currentOscillators.current = [];

    // Resume audio context if suspended (required for user interaction)
    if (audioContext.current.state === "suspended") {
      audioContext.current.resume();
    }

    const frequencies = getFrequency(selectedKey, mode);
    const gainNode = audioContext.current.createGain();
    gainNode.connect(audioContext.current.destination);
    gainNode.gain.setValueAtTime(volume, audioContext.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.current.currentTime + 0.8
    );

    frequencies.forEach((freq) => {
      // Create a more piano-like sound with multiple harmonics
      const fundamental = audioContext.current!.createOscillator();
      const harmonic2 = audioContext.current!.createOscillator();
      const harmonic3 = audioContext.current!.createOscillator();

      // Fundamental frequency
      fundamental.type = "triangle";
      fundamental.frequency.setValueAtTime(
        freq,
        audioContext.current!.currentTime
      );

      // Second harmonic (octave)
      harmonic2.type = "sine";
      harmonic2.frequency.setValueAtTime(
        freq * 2,
        audioContext.current!.currentTime
      );

      // Third harmonic (fifth)
      harmonic3.type = "sine";
      harmonic3.frequency.setValueAtTime(
        freq * 3,
        audioContext.current!.currentTime
      );

      // Create gain nodes for each harmonic to control their volumes
      const fundamentalGain = audioContext.current!.createGain();
      const harmonic2Gain = audioContext.current!.createGain();
      const harmonic3Gain = audioContext.current!.createGain();

      // Set relative volumes (fundamental loudest, harmonics quieter)
      fundamentalGain.gain.setValueAtTime(
        1.0,
        audioContext.current!.currentTime
      );
      harmonic2Gain.gain.setValueAtTime(0.3, audioContext.current!.currentTime);
      harmonic3Gain.gain.setValueAtTime(0.1, audioContext.current!.currentTime);

      // Connect everything
      fundamental.connect(fundamentalGain);
      harmonic2.connect(harmonic2Gain);
      harmonic3.connect(harmonic3Gain);

      fundamentalGain.connect(gainNode);
      harmonic2Gain.connect(gainNode);
      harmonic3Gain.connect(gainNode);

      // Start and stop all oscillators
      [fundamental, harmonic2, harmonic3].forEach((osc) => {
        osc.start();
        osc.stop(audioContext.current!.currentTime + 0.8);
        currentOscillators.current.push(osc);
      });
    });
  };

  // Pitch detection functions
  const frequencyToNote = (frequency: number): string => {
    const A4 = 440;

    if (frequency <= 0) return "";

    // Calculate semitones from A4
    const semitones = Math.round(12 * Math.log2(frequency / A4));

    // A4 is at index 9 in NOTE_NAMES (A = 9th note: C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9)
    const noteIndex = (9 + semitones) % 12;

    // Handle negative modulo
    const finalIndex = noteIndex < 0 ? noteIndex + 12 : noteIndex;

    return NOTE_NAMES[finalIndex];
  };

  // Use refs to store current values for pitch detection
  const currentStateRef = useRef({ selectedKey, currentScaleDegree, mode });

  // Update ref whenever state changes
  useEffect(() => {
    currentStateRef.current = { selectedKey, currentScaleDegree, mode };
  }, [selectedKey, currentScaleDegree, mode]);

  const detectPitch = useCallback(() => {
    if (!analyser.current) return;

    const bufferLength = analyser.current.fftSize;
    const buffer = new Float32Array(bufferLength);
    analyser.current.getFloatTimeDomainData(buffer);

    // Simple autocorrelation for pitch detection
    const sampleRate = audioContext.current!.sampleRate;
    let maxCorrelation = 0;
    let bestPeriod = 0;

    const minPeriod = Math.floor(sampleRate / 800); // ~800 Hz max
    const maxPeriod = Math.floor(sampleRate / 80); // ~80 Hz min

    for (let period = minPeriod; period < maxPeriod; period++) {
      let correlation = 0;
      for (let i = 0; i < bufferLength - period; i++) {
        correlation += buffer[i] * buffer[i + period];
      }
      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestPeriod = period;
      }
    }

    if (maxCorrelation > 0.001 && bestPeriod > 0) {
      // Threshold for signal detection
      const frequency = sampleRate / bestPeriod;
      const note = frequencyToNote(frequency);
      const currentTime = Date.now();

      // Check if this is the same note we were detecting
      if (currentDetectedNoteRef.current === note) {
        // Same note, check if we've held it long enough
        if (
          noteDetectionStartTimeRef.current &&
          currentTime - noteDetectionStartTimeRef.current >=
            DETECTION_DURATION_MS
        ) {
          // Note has been held long enough, process it
          console.log("Note confirmed after duration:", {
            frequency: frequency.toFixed(2),
            note,
            duration: currentTime - noteDetectionStartTimeRef.current,
            hasDetectedFirstNote: hasDetectedFirstNoteRef.current,
          });

          // Mark that we've detected the first note
          if (!hasDetectedFirstNoteRef.current) {
            console.log("Setting hasDetectedFirstNote to true");
            hasDetectedFirstNoteRef.current = true;
            // Now that user has played their first note, we can start recording results
            isFirstScaleDegree.current = false;
          }

          // Use current values from ref
          const {
            selectedKey: currentKey,
            currentScaleDegree: currentSD,
            mode: currentMode,
          } = currentStateRef.current;
          const expectedNote = getExpectedNote(
            currentKey,
            currentSD.degree,
            currentMode
          );

          console.log("Note comparison:", {
            detectedNote: note,
            expectedNote,
            currentKey,
            scaleDegree: currentSD.degree,
            mode: currentMode,
          });

          const isCorrect = note === expectedNote;

          setDetectedNote(note);

          if (isCorrect && !hasFoundCorrect) {
            // Found correct note for the first time - lock in green
            setNoteStatus("correct");
            setHasFoundCorrect(true);
            everFoundCorrectForCurrentDegree.current = true; // Track that we found it for this scale degree
            console.log("Found correct note, setting hasFoundCorrect to true");
          } else if (!hasFoundCorrect) {
            // Haven't found correct yet, show red for wrong notes
            setNoteStatus("incorrect");
          }
          // If hasFoundCorrect is true, keep showing green (don't change status)
        }
        // Note is being held, but not long enough yet - do nothing
      } else {
        // Different note detected, start tracking this new note
        currentDetectedNoteRef.current = note;
        noteDetectionStartTimeRef.current = currentTime;
        console.log("New note detected, starting timer:", note);
      }
    } else {
      // No signal detected, reset tracking
      if (currentDetectedNoteRef.current !== null) {
        console.log("Signal lost, resetting note tracking");
        currentDetectedNoteRef.current = null;
        noteDetectionStartTimeRef.current = null;
      }

      if (!hasFoundCorrect) {
        // Only reset to pending if we haven't found correct yet
        setDetectedNote("");
        setNoteStatus("pending");
      }
    }
  }, []); // No dependencies - function never changes

  const startPitchDetection = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStream.current = stream;

      const source = audioContext.current!.createMediaStreamSource(stream);
      analyser.current = audioContext.current!.createAnalyser();
      analyser.current.fftSize = 2048;
      source.connect(analyser.current);

      const detect = () => {
        detectPitch();
        pitchDetectionId.current = requestAnimationFrame(detect);
      };
      detect();
    } catch (error) {
      console.error("Microphone access denied:", error);
    }
  };

  const stopPitchDetection = () => {
    if (pitchDetectionId.current) {
      cancelAnimationFrame(pitchDetectionId.current);
    }
    if (microphoneStream.current) {
      microphoneStream.current.getTracks().forEach((track) => track.stop());
      microphoneStream.current = null;
    }
    setDetectedNote("");
    setNoteStatus("pending");
  };

  const generateNewScaleDegree = (): ScaleDegree => {
    let newScaleDegree: ScaleDegree;

    do {
      const degree = Math.floor(Math.random() * 7) + 1;

      if (degree === 1) {
        const rand = Math.random();
        if (rand < 0.33) {
          newScaleDegree = { degree: 1 };
        } else if (rand < 0.66) {
          newScaleDegree = { degree: 1, direction: "ABOVE" };
        } else {
          newScaleDegree = { degree: 1, direction: "BELOW" };
        }
      } else {
        const direction = Math.random() < 0.5 ? "ABOVE" : "BELOW";
        newScaleDegree = { degree, direction };
      }
    } while (
      lastCombinationRef.current &&
      newScaleDegree.degree === lastCombinationRef.current.degree &&
      newScaleDegree.direction === lastCombinationRef.current.direction
    );

    return newScaleDegree;
  };

  // Add a ref to track if this is the first scale degree
  const isFirstScaleDegree = useRef(true);

  const performRandomize = () => {
    // Record result for the previous scale degree (only if user has started playing notes)
    console.log("performRandomize called:", {
      isFirstScaleDegree: isFirstScaleDegree.current,
      hasDetectedFirstNote: hasDetectedFirstNoteRef.current,
      hasFoundCorrect,
      resultsLength: results.length,
    });

    // Only record if user has played notes AND this isn't the very first scale degree
    if (!isFirstScaleDegree.current && hasDetectedFirstNoteRef.current) {
      const wasCorrect = everFoundCorrectForCurrentDegree.current;
      console.log("Recording result:", {
        wasCorrect,
        resultsLength: results.length,
        everFoundCorrectForCurrentDegree:
          everFoundCorrectForCurrentDegree.current,
        hasFoundCorrect,
      });
      setResults((prev) => {
        const newResults = [...prev, wasCorrect];
        console.log("New results array:", newResults);
        return newResults;
      });
    } else if (!isFirstScaleDegree.current) {
      console.log("Not recording - user hasnt played any notes yet");
    } else {
      console.log("Skipping first scale degree recording (first scale degree)");
      // Don't set isFirstScaleDegree to false until user plays first note
      // This will be set to false when we detect the first note
    }

    const newScaleDegree = generateNewScaleDegree();
    setCurrentScaleDegree(newScaleDegree);
    setLastCombination(newScaleDegree);
    lastCombinationRef.current = newScaleDegree; // Keep ref in sync

    // Reset note detection state for new scale degree
    setDetectedNote("");
    setNoteStatus("pending");
    setHasFoundCorrect(false); // Reset the "found correct" flag
    everFoundCorrectForCurrentDegree.current = false; // Reset for new scale degree

    playChord(newScaleDegree);
  };

  // Auto-randomization effect
  useEffect(() => {
    if (intervalId.current) {
      clearInterval(intervalId.current);
    }

    if (isPlaying) {
      // Start pitch detection
      startPitchDetection();

      // Perform initial randomize
      performRandomize();

      // Set up interval
      intervalId.current = window.setInterval(() => {
        performRandomize();
      }, interval * 1000);
    } else {
      // Record final result before stopping (only if user has played notes)
      if (lastCombination !== null && hasDetectedFirstNoteRef.current) {
        const wasCorrect = everFoundCorrectForCurrentDegree.current;
        setResults((prev) => [...prev, wasCorrect]);
      }

      // Stop pitch detection when not playing
      stopPitchDetection();
    }

    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
      }
      stopPitchDetection();
    };
  }, [isPlaying, interval, selectedKey, mode, volume, isMuted]); // Include all audio settings

  const formatScaleDegree = (scaleDegree: ScaleDegree): string => {
    if (scaleDegree.degree === 1 && !scaleDegree.direction) {
      return "1";
    }
    return `${scaleDegree.degree} ${scaleDegree.direction}`;
  };

  const calculateAccuracy = (): number => {
    if (results.length === 0) return 0;
    const correct = results.filter((result) => result).length;
    return Math.round((correct / results.length) * 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 flex items-center justify-center p-4">
      <div className="backdrop-blur-xl bg-white/20 rounded-3xl border border-white/30 shadow-2xl p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-white text-center mb-8 drop-shadow-lg">
          Chord Scale Randomizer
        </h1>

        {/* Scale Degree Display */}
        <div className="text-center mb-8">
          <div className="backdrop-blur-lg bg-white/30 rounded-2xl border border-white/40 p-6 mb-4">
            <div className="text-6xl font-bold text-white drop-shadow-lg mb-2">
              {formatScaleDegree(currentScaleDegree)}
            </div>
            <div className="text-lg text-white/80">
              {selectedKey} {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </div>
          </div>

          {/* Note Detection Indicator */}
          {isPlaying && (
            <div className="flex justify-center">
              <div
                className={`px-6 py-3 rounded-xl font-bold text-white text-lg border-2 ${
                  noteStatus === "pending"
                    ? "bg-blue-500/70 border-blue-400"
                    : noteStatus === "correct"
                    ? "bg-green-500/70 border-green-400"
                    : "bg-red-500/70 border-red-400"
                }`}
              >
                {detectedNote || "..."}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-6">
          {/* Play/Stop Button */}
          <button
            onClick={() => {
              if (!isPlaying) {
                // Starting - reset all detection and results
                setResults([]);
                hasDetectedFirstNoteRef.current = false;
                everFoundCorrectForCurrentDegree.current = false;
                isFirstScaleDegree.current = true;
                currentDetectedNoteRef.current = null;
                noteDetectionStartTimeRef.current = null;
                setHasFoundCorrect(false);
                setDetectedNote("");
                setNoteStatus("pending");
              }
              setIsPlaying(!isPlaying);
            }}
            className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 transform hover:scale-105"
          >
            {isPlaying ? "Stop" : "Start"} Auto-Randomizer
          </button>

          {/* Interval Control */}
          <div className="backdrop-blur-lg bg-white/20 rounded-xl p-4">
            <label className="block text-white text-sm font-medium mb-3">
              Interval: {interval}s
            </label>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              value={interval}
              onChange={(e) => setInterval(parseFloat(e.target.value))}
              className="w-full h-2 bg-white/30 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Key Selection */}
          <div className="backdrop-blur-lg bg-white/20 rounded-xl p-4">
            <label className="block text-white text-sm font-medium mb-3">
              Key
            </label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="w-full p-3 bg-white/30 backdrop-blur-sm border border-white/40 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {KEYS.map((key) => (
                <option key={key} value={key} className="bg-gray-800">
                  {key}
                </option>
              ))}
            </select>
          </div>

          {/* Mode Selection */}
          <div className="backdrop-blur-lg bg-white/20 rounded-xl p-4">
            <label className="block text-white text-sm font-medium mb-3">
              Mode
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("major")}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                  mode === "major"
                    ? "bg-white/40 text-white shadow-lg"
                    : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                Major
              </button>
              <button
                onClick={() => setMode("minor")}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                  mode === "minor"
                    ? "bg-white/40 text-white shadow-lg"
                    : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                Minor
              </button>
            </div>
          </div>

          {/* Volume Control */}
          <div className="backdrop-blur-lg bg-white/20 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-white text-sm font-medium">Volume</label>
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                  isMuted
                    ? "bg-red-500/50 text-white"
                    : "bg-white/20 text-white hover:bg-white/30"
                }`}
              >
                {isMuted ? "Muted" : "Unmuted"}
              </button>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              disabled={isMuted}
              className="w-full h-2 bg-white/30 rounded-lg appearance-none cursor-pointer slider disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Accuracy Tracking */}
          {(() => {
            console.log("Checking results for UI render:", {
              results,
              length: results.length,
            });
            return results.length > 0;
          })() && (
            <>
              {/* Accuracy Percentage */}
              <div className="backdrop-blur-lg bg-white/20 rounded-xl p-4">
                <div className="text-xl font-bold text-white text-center mb-2">
                  Accuracy: {calculateAccuracy()}%
                </div>
                <div className="text-sm text-white/70 text-center">
                  {results.filter((r) => r).length} correct out of{" "}
                  {results.length} attempts
                </div>
              </div>

              {/* Results List */}
              <div className="backdrop-blur-lg bg-white/20 rounded-xl border border-white/30 p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="text-white text-sm font-medium">Results</div>
                  <button
                    onClick={() => {
                      setResults([]);
                      // Reset detection state so no new results are recorded until user plays first note again
                      hasDetectedFirstNoteRef.current = false;
                      everFoundCorrectForCurrentDegree.current = false;
                      isFirstScaleDegree.current = true;
                      // Reset duration tracking
                      currentDetectedNoteRef.current = null;
                      noteDetectionStartTimeRef.current = null;
                    }}
                    className="px-3 py-1 text-xs bg-white/20 hover:bg-white/30 text-white rounded-lg transition-all"
                  >
                    Reset
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {results.map((isCorrect, index) => (
                    <div
                      key={index}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg ${
                        isCorrect
                          ? "bg-green-500/70 border-green-400 text-white"
                          : "bg-red-500/70 border-red-400 text-white"
                      } border-2`}
                    >
                      {isCorrect ? "✓" : "✕"}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChordScaleRandomizer;
