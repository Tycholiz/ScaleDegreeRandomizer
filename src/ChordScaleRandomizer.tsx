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
  // Initialize state with saved values from localStorage
  const [interval, setInterval] = useState(() => {
    const saved = localStorage.getItem("scaleDegreeRandomizer_interval");
    if (saved) {
      const parsed = parseFloat(saved);
      if (parsed >= 1 && parsed <= 5) {
        return parsed;
      }
    }
    return 3.0;
  });

  const [selectedKey, setSelectedKey] = useState(() => {
    const saved = localStorage.getItem("scaleDegreeRandomizer_key");
    if (saved && KEYS.includes(saved)) {
      return saved;
    }
    return "C";
  });

  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem("scaleDegreeRandomizer_mode");
    if (saved && (saved === "major" || saved === "minor")) {
      return saved as Mode;
    }
    return "major";
  });

  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("scaleDegreeRandomizer_volume");
    if (saved) {
      const parsed = parseFloat(saved);
      if (parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
    return 0.3;
  });
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
          // Initialize microphone if needed
          const micReady = await initializeMicrophone();
          if (micReady) {
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
          } else {
            // Microphone access denied or not available
            alert(
              "Microphone access is required to use the Scale Degree Randomizer. Please grant microphone permission and try again."
            );
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
        const dropdown = document.getElementById("settings-dropdown");
        const button = document.getElementById("settings-button");

        if (
          dropdown &&
          button &&
          !dropdown.contains(target) &&
          !button.contains(target)
        ) {
          setShowSettingsMenu(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSettingsMenu]);

  // Handle page visibility change to stop playback when tab loses focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isPlaying) {
        setIsPlaying(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isPlaying]);

  // Cleanup microphone stream on component unmount
  useEffect(() => {
    return () => {
      if (microphoneStream.current) {
        microphoneStream.current.getTracks().forEach((track) => track.stop());
        microphoneStream.current = null;
      }
    };
  }, []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("scaleDegreeRandomizer_interval", interval.toString());
  }, [interval]);

  useEffect(() => {
    localStorage.setItem("scaleDegreeRandomizer_key", selectedKey);
  }, [selectedKey]);

  useEffect(() => {
    localStorage.setItem("scaleDegreeRandomizer_mode", mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("scaleDegreeRandomizer_volume", volume.toString());
  }, [volume]);

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

  const noteToScaleDegree = (
    noteName: string,
    keyName: string,
    mode: Mode
  ): string => {
    const noteIndex = NOTE_NAMES.findIndex((note) => note === noteName);
    const keyIndex = KEYS.findIndex((key) => key === keyName);

    if (noteIndex === -1 || keyIndex === -1) return "?";

    // Calculate the interval from the key
    let interval = (noteIndex - keyIndex + 12) % 12;

    if (mode === "major") {
      const majorIntervals = [0, 2, 4, 5, 7, 9, 11];

      // Find exact match first
      const degreeIndex = majorIntervals.findIndex((i) => i === interval);
      if (degreeIndex !== -1) {
        return (degreeIndex + 1).toString();
      }

      // Check for chromatic alterations relative to major scale
      for (let i = 0; i < majorIntervals.length; i++) {
        const naturalInterval = majorIntervals[i];
        const degree = i + 1;

        if (interval === (naturalInterval + 1) % 12) {
          return `#${degree}`;
        } else if (interval === (naturalInterval - 1 + 12) % 12) {
          return `♭${degree}`;
        }
      }
    } else {
      // For minor mode, we want to show the scale degrees relative to the natural minor scale
      // Natural minor intervals: 1, 2, b3, 4, 5, b6, b7
      const minorIntervals = [0, 2, 3, 5, 7, 8, 10];
      const minorDegreeNames = ["1", "2", "♭3", "4", "5", "♭6", "♭7"];

      // Find exact match first
      const degreeIndex = minorIntervals.findIndex((i) => i === interval);
      if (degreeIndex !== -1) {
        return minorDegreeNames[degreeIndex];
      }

      // Check for chromatic alterations relative to natural minor scale
      // Special handling for interval 11 (major 7th) - this should be "7", not "♭1"
      if (interval === 11) {
        return "7";
      }
      
      for (let i = 0; i < minorIntervals.length; i++) {
        const naturalInterval = minorIntervals[i];
        const degreeName = minorDegreeNames[i];

        if (interval === (naturalInterval + 1) % 12) {
          // Sharp version of the minor scale degree
          if (degreeName.startsWith("♭")) {
            // If it's already flat (like ♭3), sharp makes it natural (3)
            return degreeName.substring(1);
          } else {
            return `#${degreeName}`;
          }
        } else if (interval === (naturalInterval - 1 + 12) % 12) {
          // Flat version of the minor scale degree
          if (!degreeName.startsWith("♭")) {
            return `♭${degreeName}`;
          }
        }
      }
    }

    return "?";
  };

  const getFrequency = (keyName: string, mode: Mode): number[] => {
    const keyIndex = KEYS.findIndex((key) => key === keyName);
    const baseFrequency = 261.63; // C4
    const semitoneRatio = Math.pow(2, 1 / 12);

    // For keys G# and above (G#, A, A#, B), lower by one octave
    const octaveAdjustment = keyIndex >= 8 ? -12 : 0; // G# is at index 8
    const adjustedKeyIndex = keyIndex + octaveAdjustment;

    // Always play the root chord of the selected key
    const rootFreq = baseFrequency * Math.pow(semitoneRatio, adjustedKeyIndex);

    if (mode === "major") {
      // Major triad: root, major third, perfect fifth
      const thirdFreq =
        baseFrequency * Math.pow(semitoneRatio, adjustedKeyIndex + 4); // Major third (4 semitones)
      const fifthFreq =
        baseFrequency * Math.pow(semitoneRatio, adjustedKeyIndex + 7); // Perfect fifth (7 semitones)
      return [rootFreq, thirdFreq, fifthFreq];
    } else {
      // Minor triad: root, minor third, perfect fifth
      const thirdFreq =
        baseFrequency * Math.pow(semitoneRatio, adjustedKeyIndex + 3); // Minor third (3 semitones)
      const fifthFreq =
        baseFrequency * Math.pow(semitoneRatio, adjustedKeyIndex + 7); // Perfect fifth (7 semitones)
      return [rootFreq, thirdFreq, fifthFreq];
    }
  };

  const stopChord = () => {
    // Stop any currently playing oscillators immediately
    currentOscillators.current.forEach((osc) => {
      try {
        osc.stop();
      } catch (e) {
        // Oscillator may already be stopped
      }
    });
    currentOscillators.current = [];
  };

  const playChord = (scaleDegree: ScaleDegree, duration: number = interval) => {
    if (!audioContext.current || isMuted) return;

    // Stop any currently playing oscillators
    stopChord();

    // Resume audio context if suspended (required for user interaction)
    if (audioContext.current.state === "suspended") {
      audioContext.current.resume();
    }

    const frequencies = getFrequency(selectedKey, mode);
    const masterGain = audioContext.current.createGain();
    masterGain.connect(audioContext.current.destination);

    // Balanced master volume to prevent clipping while maintaining good volume
    const masterVolume = volume * 0.45; // Balanced volume for good listening level
    masterGain.gain.setValueAtTime(masterVolume, audioContext.current.currentTime);

    frequencies.forEach((freq) => {
      // Create a much more pleasant electric piano-like sound
      const osc1 = audioContext.current!.createOscillator();
      const osc2 = audioContext.current!.createOscillator();
      const osc3 = audioContext.current!.createOscillator();

      // Use sine waves for cleaner sound
      osc1.type = "sine";
      osc2.type = "sine";
      osc3.type = "sine";

      // Fundamental and carefully chosen harmonics for piano-like timbre
      osc1.frequency.setValueAtTime(freq, audioContext.current!.currentTime);
      osc2.frequency.setValueAtTime(freq * 2, audioContext.current!.currentTime); // Octave
      osc3.frequency.setValueAtTime(freq * 4, audioContext.current!.currentTime); // Two octaves

      // Create individual gain controls
      const gain1 = audioContext.current!.createGain();
      const gain2 = audioContext.current!.createGain();
      const gain3 = audioContext.current!.createGain();

      // Much lower harmonic levels to prevent clipping
      const baseLevel1 = 0.3; // Reduced from 0.8
      const baseLevel2 = 0.08; // Reduced from 0.15
      const baseLevel3 = 0.02; // Reduced from 0.05

      // Add gentle attack and decay envelopes for more realistic sound
      const attackTime = 0.02;
      const releaseTime = duration; // Use the full interval duration
      const currentTime = audioContext.current!.currentTime;

      // Set initial values
      gain1.gain.setValueAtTime(0, currentTime);
      gain2.gain.setValueAtTime(0, currentTime);
      gain3.gain.setValueAtTime(0, currentTime);

      // Attack phase
      gain1.gain.linearRampToValueAtTime(baseLevel1, currentTime + attackTime);
      gain2.gain.linearRampToValueAtTime(baseLevel2, currentTime + attackTime);
      gain3.gain.linearRampToValueAtTime(baseLevel3, currentTime + attackTime);

      // Sustain at full level until near the end, then decay
      const sustainTime = releaseTime - 0.1; // Sustain for most of the duration
      const decayTime = 0.1; // Short decay at the end

      gain1.gain.setValueAtTime(baseLevel1, currentTime + sustainTime);
      gain2.gain.setValueAtTime(baseLevel2, currentTime + sustainTime);
      gain3.gain.setValueAtTime(baseLevel3, currentTime + sustainTime);

      // Quick decay at the end
      gain1.gain.exponentialRampToValueAtTime(0.01, currentTime + releaseTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, currentTime + releaseTime);
      gain3.gain.exponentialRampToValueAtTime(0.01, currentTime + releaseTime);

      // Connect the audio graph
      osc1.connect(gain1);
      osc2.connect(gain2);
      osc3.connect(gain3);

      gain1.connect(masterGain);
      gain2.connect(masterGain);
      gain3.connect(masterGain);

      // Start and schedule stop
      [osc1, osc2, osc3].forEach((osc) => {
        osc.start(currentTime);
        osc.stop(currentTime + releaseTime);
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
          const detectedScaleDegree = noteToScaleDegree(
            note,
            currentKey,
            currentMode
          );
          setDetectedNote(detectedScaleDegree);

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

  const initializeMicrophone = async () => {
    try {
      if (!microphoneStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        microphoneStream.current = stream;

        const source = audioContext.current!.createMediaStreamSource(stream);
        analyser.current = audioContext.current!.createAnalyser();
        analyser.current.fftSize = 2048;
        source.connect(analyser.current);
      }
      return true;
    } catch (error) {
      console.error("Microphone access denied:", error);
      return false;
    }
  };

  const startPitchDetection = async () => {
    const micReady = await initializeMicrophone();
    if (micReady) {
      const detect = () => {
        detectPitch();
        pitchDetectionId.current = requestAnimationFrame(detect);
      };
      detect();
    }
  };

  const stopPitchDetection = () => {
    if (pitchDetectionId.current) {
      cancelAnimationFrame(pitchDetectionId.current);
      pitchDetectionId.current = null;
    }
    // Keep microphone stream alive to maintain permissions
    // Only stop it when the component unmounts
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

    playChord(newScaleDegree, interval);
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

      // Stop the chord immediately
      stopChord();

      // Stop pitch detection when not playing
      stopPitchDetection();
    }

    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
      }
      stopChord();
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
                      min="1"
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
                  alert(
                    "Microphone access is required to use the Scale Degree Randomizer. Please grant microphone permission and try again."
                  );
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

          {/* Results Section - Always visible to prevent layout shift */}
          <div className="backdrop-blur-lg bg-white/20 rounded-xl border border-white/30 p-4">
            <div className="flex justify-between items-center mb-3">
              <div className="text-white text-sm font-medium">
                Results{" "}
                {results.length > 0 && `- ${calculateAccuracy()}% accurate`}
              </div>
              {results.length > 0 && (
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
              )}
            </div>
            <div className="flex flex-wrap gap-2 justify-center min-h-[2rem]">
              {results.length > 0 ? (
                results.map((isCorrect, index) => (
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
                ))
              ) : (
                <div className="text-white/50 text-sm text-center py-2">
                  Your accuracy results will appear here
                </div>
              )}
            </div>
          </div>
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
                    <strong>"6 ABOVE"</strong> - 6th scale degree above the root
                  </li>
                  <li>
                    <strong>"3 BELOW"</strong> - 3rd scale degree below the root
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  Guitar Players
                </h3>
                <p className="mb-3">
                  <strong>Explore Different Positions:</strong> Don't get
                  comfortable playing scale degrees in just one position! For
                  example, if you're playing the <strong>2nd degree</strong> two
                  frets up from the root, also try playing it three frets down
                  and one string up.
                </p>
                <p className="mb-3">
                  <strong>Mix and Match Shapes:</strong> Once you find a
                  comfortable <strong>2nd degree</strong> in an alternate
                  position, try playing the <strong>5th degree</strong> two
                  frets down and one string down from there. This builds
                  proficiency across different scale shapes and positions.
                </p>
                <p>
                  <strong>Master Your Key:</strong> The goal is to know your way
                  around whatever key you're playing in, regardless of position
                  or scale shape. This develops true fretboard mastery and
                  musical fluency.
                </p>
              </div>

              <div className="bg-white/10 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2 text-white/90">
                  Pro Tips
                </h3>
                <div className="space-y-3">
                  <p>
                    <strong>1.</strong> Focus on the <em>feeling</em> each scale
                    degree creates against the underlying chord. The 1st feels
                    stable and resolved, the 7th feels tense and wants to
                    resolve up, the 5th feels strong and supportive. This
                    functional understanding will make you a better musician!
                  </p>
                  <p>
                    <strong>2.</strong>{" "}
                    <strong>Prioritize accuracy over speed.</strong> When
                    thinking about chord changes, they usually don't move more
                    often than once every two seconds. However, scale degrees in
                    guitar solos can be hit much more frequently. Regardless of
                    tempo, accuracy is always more important than speed -
                    develop precision first, then gradually increase your pace.
                  </p>
                  <p>
                    <strong>3.</strong> <strong>Hum before you play.</strong>{" "}
                    Try to hum the target note before hitting it on your
                    instrument. This trains your ear to know what the note
                    sounds like <em>before</em> you play it. Just hitting notes
                    is useful, but you aren't teaching your ear what it sounds
                    like beforehand. You might know where the note is in
                    relation to the scale, but humming first develops your
                    ability to hear it internally before confirming with your
                    instrument.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChordScaleRandomizer;
