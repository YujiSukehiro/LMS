'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pickCallerVoice, speakableText } from './voice-core';
import type { TranscriptMessage } from './TranscriptChat';

const MUTE_KEY = 'pulse.verbalPractice.callerVoiceMuted';

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}

/**
 * Reads each new counterparty message aloud with the browser's built-in speech voice.
 * When several lines arrive at once (the opener, or a resumed session's history) only the latest is read.
 */
export function useCallerVoice(messages: TranscriptMessage[], enabled: boolean) {
  const [supported, setSupported] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const spokenIds = useRef<Set<string> | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);
    setMutedState(readMuted());
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      voiceRef.current = pickCallerVoice(synth.getVoices());
    };
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      synth.removeEventListener?.('voiceschanged', loadVoices);
      synth.cancel();
    };
  }, []);

  useEffect(() => {
    // Wait until speech support is known, so the opening line is not marked as read before it can be spoken.
    if (!supported) return;
    if (spokenIds.current === null) spokenIds.current = new Set();
    const fresh = messages.filter((m) => m.role === 'counterparty' && !spokenIds.current!.has(m.id));
    for (const m of messages) spokenIds.current.add(m.id);
    if (muted || !enabled || fresh.length === 0) return;
    const synth = window.speechSynthesis;
    // Several new lines at once (the opening line, or a resumed session's history): read only the latest one.
    for (const message of fresh.slice(-1)) {
      const text = speakableText(message.content);
      if (!text) continue;
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang ?? 'en-US';
      utterance.rate = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(synth.speaking || synth.pending);
      utterance.onerror = () => setSpeaking(synth.speaking || synth.pending);
      setSpeaking(true);
      synth.speak(utterance);
    }
  }, [messages, supported, muted, enabled]);

  useEffect(() => {
    if (!enabled && supported) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, [enabled, supported]);

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      writeMuted(next);
      if (next && supported) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
    },
    [supported],
  );

  /** Stop the caller mid-sentence, for example when the agent starts talking over them. */
  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  return { supported, muted, setMuted, speaking, stop };
}
