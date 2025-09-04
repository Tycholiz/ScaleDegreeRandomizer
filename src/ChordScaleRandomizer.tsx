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
  const [showUserManual, setShowUserManual] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
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
    const handleKeyPress = async (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault(); // Prevent page scrolling

        // Toggle play state
        if (!isPlaying) {
          // Check microphone access before starting
          try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            // If we get here, mic access is granted
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
            setIsPlaying(true);
          } catch (error) {
            // Microphone access denied or not available
            alert("Microphone access is required to use the Scale Degree Randomizer. Please grant microphone permission and try again.");
            return;
          }
        } else {
          // Stopping
          setIsPlaying(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [isPlaying]); // Add isPlaying as dependency since we're using it in the handler

  // Click outside handler for settings dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showSettingsMenu) {
        // Check if the click was outside the settings dropdown
        const target = event.target as Element;
        const dropdown = document.getElementById('settings-dropdown');
        const button = document.getElementById('settings-button');
        
        if (dropdown && button && 
            !dropdown.contains(target) && 
            !button.contains(target)) {
          setShowSettingsMenu(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettingsMenu]);

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
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white drop-shadow-lg mb-4">
            Scale Degree Randomizer
          </h1>
          <div className="flex justify-between gap-4">
            <button
              onClick={() => setShowUserManual(true)}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-sm rounded-lg border border-white/30 transition-all"
            >
              User Manual
            </button>
            <div className="relative">
              <button
                id="settings-button"
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-sm rounded-lg border border-white/30 transition-all"
              >
                <div className="flex flex-col gap-1">
                  <div className="w-4 h-0.5 bg-white"></div>
                  <div className="w-4 h-0.5 bg-white"></div>
                  <div className="w-4 h-0.5 bg-white"></div>
                </div>
              </button>

              {/* Settings Dropdown */}
              {showSettingsMenu && (
                <div 
                  id="settings-dropdown"
                  className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-xl z-10 p-4 space-y-4"
                >
                  {/* Interval Control */}
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-3">
                      Interval: {interval}s
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="5"
                      step="0.25"
                      value={interval}
                      onChange={(e) => {
                        setInterval(parseFloat(e.target.value));
                        setIsPlaying(false);
                      }}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    />
                  </div>

                  {/* Key Selection */}
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-3">
                      Key
                    </label>
                    <select
                      value={selectedKey}
                      onChange={(e) => {
                        setSelectedKey(e.target.value);
                        setIsPlaying(false);
                      }}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {KEYS.map((key) => (
                        <option key={key} value={key} className="bg-white">
                          {key}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Mode Selection */}
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-3">
                      Mode
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setMode("major");
                          setIsPlaying(false);
                        }}
                        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                          mode === "major"
                            ? "bg-blue-500 text-white shadow-lg"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        Major
                      </button>
                      <button
                        onClick={() => {
                          setMode("minor");
                          setIsPlaying(false);
                        }}
                        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                          mode === "minor"
                            ? "bg-blue-500 text-white shadow-lg"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        Minor
                      </button>
                    </div>
                  </div>

                  {/* Volume Control */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-gray-700 text-sm font-medium">
                        Volume
                      </label>
                      <button
                        onClick={() => {
                          setIsMuted(!isMuted);
                          setIsPlaying(false);
                        }}
                        className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                          isMuted
                            ? "bg-red-500 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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
                      onChange={(e) => {
                        setVolume(parseFloat(e.target.value));
                        setIsPlaying(false);
                      }}
                      disabled={isMuted}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

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
          <div className="flex justify-center">
            {isPlaying ? (
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
            ) : (
              <div className="px-6 py-3 rounded-xl font-bold text-transparent text-lg border-2 border-transparent">
                ...
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-6">
          {/* Play/Stop Button */}
          <button
            onClick={async () => {
              if (!isPlaying) {
                // Check microphone access before starting
                try {
                  await navigator.mediaDevices.getUserMedia({ audio: true });
                  // If we get here, mic access is granted
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
                  setIsPlaying(true);
                } catch (error) {
                  // Microphone access denied or not available
                  alert("Microphone access is required to use the Scale Degree Randomizer. Please grant microphone permission and try again.");
                  return;
                }
              } else {
                // Stopping
                setIsPlaying(false);
              }
            }}
            className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 transform hover:scale-105"
          >
            {isPlaying ? "Stop" : "Start"}
          </button>

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

      {/* User Manual Modal */}
      {showUserManual && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setShowUserManual(false)}
        >
          <div 
            className="backdrop-blur-xl bg-white/20 rounded-3xl border border-white/30 shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">User Manual</h2>
              <button
                onClick={() => setShowUserManual(false)}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg border border-white/30 transition-all"
              >
                Close
              </button>
            </div>

            <div className="text-white space-y-4 text-sm leading-relaxed">
              <div>
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  Purpose
                </h3>
                <p>
                  This Chord Scale Randomizer is designed to help you learn to
                  recognize different scale degrees by their{" "}
                  <strong>functional purpose</strong> rather than by name. For
                  example, it makes more sense to learn a chord as a{" "}
                  <strong>V</strong> than it does to learn it as a{" "}
                  <strong>G</strong>. "V" indicates the function of the chord,
                  whereas "G" just identifies it as its pitch.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  Why Scale Degrees Matter
                </h3>
                <p>
                  When you learn to recognize scale degrees, it gives you more
                  musical control because you recognize what a{" "}
                  <strong>6</strong> sounds like against a <strong>1</strong>.
                  You hear what a <strong>3</strong> sounds like against a{" "}
                  <strong>1</strong> and how these notes relate to each other
                  functionally within the key.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  The Importance of the Underlying Chord
                </h3>
                <p>
                  The key's chord plays underneath each scale degree to
                  accentuate that a <strong>1</strong> sounds a certain way over
                  the chord and a <strong>5</strong> sounds a certain way over
                  the chord. Having this harmonic foundation is vitally
                  important because it establishes the tonal center and helps
                  your ear understand the relationship between each scale degree
                  and the key.
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  How to Use
                </h3>
                <ul className="space-y-2 ml-4">
                  <li>
                    <strong>1.</strong> Press{" "}
                    <span className="bg-white/20 px-2 py-1 rounded">
                      Space Bar
                    </span>{" "}
                    or click "Start"
                  </li>
                  <li>
                    <strong>2.</strong> Allow microphone access when prompted
                  </li>
                  <li>
                    <strong>3.</strong> Listen to the chord and see the scale
                    degree displayed (e.g., "6 ABOVE")
                  </li>
                  <li>
                    <strong>4.</strong> Sing or play the corresponding note on
                    your instrument
                  </li>
                  <li>
                    <strong>5.</strong> The note detection will show green for
                    correct, red for incorrect
                  </li>
                  <li>
                    <strong>6.</strong> Your accuracy is tracked with checkmarks
                    (✓) and X's (✕)
                  </li>
                  <li>
                    <strong>7.</strong> Adjust the interval speed using the
                    slider
                  </li>
                  <li>
                    <strong>8.</strong> Try different keys and modes
                    (major/minor)
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  Scale Degree Notation
                </h3>
                <ul className="space-y-1 ml-4">
                  <li>
                    <strong>"1"</strong> - Root note (tonic)
                  </li>
                  <li>
                    <strong>"6 ABOVE"</strong> - 6th scale degree, one octave
                    higher
                  </li>
                  <li>
                    <strong>"3 BELOW"</strong> - 3rd scale degree, one octave
                    lower
                  </li>
                </ul>
              </div>

              <div className="bg-white/10 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  Pro Tip
                </h3>
                <p>
                  Focus on the <em>feeling</em> each scale degree creates
                  against the underlying chord. The 1st feels stable and
                  resolved, the 7th feels tense and wants to resolve up, the 5th
                  feels strong and supportive. This functional understanding
                  will make you a better musician!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChordScaleRandomizer;
