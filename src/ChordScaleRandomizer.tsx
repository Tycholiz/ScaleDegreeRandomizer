import React, { useState, useEffect, useRef } from 'react';

type Direction = 'ABOVE' | 'BELOW';
type Mode = 'major' | 'minor';

interface ScaleDegree {
  degree: number;
  direction?: Direction;
}

const KEYS = [
  'C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 
  'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'
];

const ChordScaleRandomizer: React.FC = () => {
  const [currentScaleDegree, setCurrentScaleDegree] = useState<ScaleDegree>({ degree: 1 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [interval, setInterval] = useState(2.0);
  const [selectedKey, setSelectedKey] = useState('C');
  const [mode, setMode] = useState<Mode>('major');
  const [volume, setVolume] = useState(0.3);
  const [isMuted, setIsMuted] = useState(false);
  const [lastCombination, setLastCombination] = useState<ScaleDegree | null>(null);
  
  const audioContext = useRef<AudioContext | null>(null);
  const intervalId = useRef<number | null>(null);
  const currentOscillators = useRef<OscillatorNode[]>([]);

  useEffect(() => {
    audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      if (audioContext.current) {
        audioContext.current.close();
      }
    };
  }, []);

  const getFrequency = (keyName: string, mode: Mode): number[] => {
    const keyIndex = KEYS.findIndex(key => key === keyName);
    const baseFrequency = 261.63; // C4
    const semitoneRatio = Math.pow(2, 1/12);
    
    // Always play the root chord of the selected key
    const rootFreq = baseFrequency * Math.pow(semitoneRatio, keyIndex);
    
    if (mode === 'major') {
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
    currentOscillators.current.forEach(osc => {
      try {
        osc.stop();
      } catch (e) {
        // Oscillator may already be stopped
      }
    });
    currentOscillators.current = [];

    // Resume audio context if suspended (required for user interaction)
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }

    const frequencies = getFrequency(selectedKey, mode);
    const gainNode = audioContext.current.createGain();
    gainNode.connect(audioContext.current.destination);
    gainNode.gain.setValueAtTime(volume, audioContext.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.current.currentTime + 0.8);

    frequencies.forEach(freq => {
      // Create a more piano-like sound with multiple harmonics
      const fundamental = audioContext.current!.createOscillator();
      const harmonic2 = audioContext.current!.createOscillator();
      const harmonic3 = audioContext.current!.createOscillator();
      
      // Fundamental frequency
      fundamental.type = 'triangle';
      fundamental.frequency.setValueAtTime(freq, audioContext.current!.currentTime);
      
      // Second harmonic (octave)
      harmonic2.type = 'sine';
      harmonic2.frequency.setValueAtTime(freq * 2, audioContext.current!.currentTime);
      
      // Third harmonic (fifth)
      harmonic3.type = 'sine';
      harmonic3.frequency.setValueAtTime(freq * 3, audioContext.current!.currentTime);
      
      // Create gain nodes for each harmonic to control their volumes
      const fundamentalGain = audioContext.current!.createGain();
      const harmonic2Gain = audioContext.current!.createGain();
      const harmonic3Gain = audioContext.current!.createGain();
      
      // Set relative volumes (fundamental loudest, harmonics quieter)
      fundamentalGain.gain.setValueAtTime(1.0, audioContext.current!.currentTime);
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
      [fundamental, harmonic2, harmonic3].forEach(osc => {
        osc.start();
        osc.stop(audioContext.current!.currentTime + 0.8);
        currentOscillators.current.push(osc);
      });
    });
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
          newScaleDegree = { degree: 1, direction: 'ABOVE' };
        } else {
          newScaleDegree = { degree: 1, direction: 'BELOW' };
        }
      } else {
        const direction = Math.random() < 0.5 ? 'ABOVE' : 'BELOW';
        newScaleDegree = { degree, direction };
      }
    } while (
      lastCombination && 
      newScaleDegree.degree === lastCombination.degree &&
      newScaleDegree.direction === lastCombination.direction
    );

    return newScaleDegree;
  };

  const performRandomize = () => {
    const newScaleDegree = generateNewScaleDegree();
    setCurrentScaleDegree(newScaleDegree);
    setLastCombination(newScaleDegree);
    playChord(newScaleDegree);
  };

  // Auto-randomization effect
  useEffect(() => {
    if (intervalId.current) {
      clearInterval(intervalId.current);
    }

    if (isPlaying) {
      // Perform initial randomize
      performRandomize();
      
      // Set up interval
      intervalId.current = window.setInterval(() => {
        performRandomize();
      }, interval * 1000);
    }

    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
      }
    };
  }, [isPlaying, interval]); // Only depend on isPlaying and interval

  const formatScaleDegree = (scaleDegree: ScaleDegree): string => {
    if (scaleDegree.degree === 1 && !scaleDegree.direction) {
      return '1';
    }
    return `${scaleDegree.degree} ${scaleDegree.direction}`;
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
        </div>

        {/* Controls */}
        <div className="space-y-6">
          {/* Play/Stop Button */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 transform hover:scale-105"
          >
            {isPlaying ? 'Stop' : 'Start'} Auto-Randomizer
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
            <label className="block text-white text-sm font-medium mb-3">Key</label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="w-full p-3 bg-white/30 backdrop-blur-sm border border-white/40 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {KEYS.map(key => (
                <option key={key} value={key} className="bg-gray-800">
                  {key}
                </option>
              ))}
            </select>
          </div>

          {/* Mode Selection */}
          <div className="backdrop-blur-lg bg-white/20 rounded-xl p-4">
            <label className="block text-white text-sm font-medium mb-3">Mode</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('major')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                  mode === 'major'
                    ? 'bg-white/40 text-white shadow-lg'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                Major
              </button>
              <button
                onClick={() => setMode('minor')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                  mode === 'minor'
                    ? 'bg-white/40 text-white shadow-lg'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
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
                    ? 'bg-red-500/50 text-white'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {isMuted ? 'Muted' : 'Unmuted'}
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
        </div>
      </div>
    </div>
  );
};

export default ChordScaleRandomizer;