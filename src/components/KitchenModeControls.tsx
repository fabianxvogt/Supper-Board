'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function KitchenModeControls() {
  const [wakeStatus, setWakeStatus] = useState('');
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const wakeLockWanted = useRef(false);

  const acquireWakeLock = useCallback(async function requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      wakeLockWanted.current = false;
      setWakeStatus('Dieser Browser bietet keinen Bildschirm-Wachmodus. Stelle die automatische Displaysperre in den Geräteeinstellungen vorübergehend um.');
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!wakeLockWanted.current || document.visibilityState !== 'visible') {
        await sentinel.release();
        return;
      }
      wakeLock.current = sentinel;
      sentinel.addEventListener('release', () => {
        if (wakeLock.current !== sentinel) return;
        wakeLock.current = null;
        setWakeLockActive(false);
        if (wakeLockWanted.current && document.visibilityState === 'visible') {
          void requestWakeLock();
        } else if (!wakeLockWanted.current) {
          setWakeStatus('Der Wachmodus ist ausgeschaltet.');
        }
      }, { once: true });
      if (sentinel.released) {
        wakeLock.current = null;
        setWakeLockActive(false);
        return;
      }
      setWakeLockActive(true);
      setWakeStatus('Bildschirm bleibt während dieser Sitzung wach.');
    } catch {
      if (wakeLockWanted.current) {
        wakeLockWanted.current = false;
        setWakeLockActive(false);
        setWakeStatus('Der Browser hat den Wachmodus nicht freigegeben. Die Geräteeinstellungen bleiben verfügbar.');
      }
    }
  }, []);

  useEffect(() => {
    function syncFullScreen() {
      setFullScreen(Boolean(document.fullscreenElement));
    }
    function syncWakeLockVisibility() {
      const sentinel = wakeLock.current;
      if (document.visibilityState !== 'visible') {
        setWakeLockActive(false);
        return;
      }
      if (sentinel && !sentinel.released) {
        setWakeLockActive(true);
      } else {
        wakeLock.current = null;
        setWakeLockActive(false);
        if (wakeLockWanted.current) void acquireWakeLock();
      }
    }
    document.addEventListener('fullscreenchange', syncFullScreen);
    document.addEventListener('visibilitychange', syncWakeLockVisibility);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullScreen);
      document.removeEventListener('visibilitychange', syncWakeLockVisibility);
      wakeLockWanted.current = false;
      const sentinel = wakeLock.current;
      wakeLock.current = null;
      if (sentinel) void sentinel.release();
    };
  }, [acquireWakeLock]);

  async function toggleWakeLock() {
    if (wakeLockWanted.current) {
      wakeLockWanted.current = false;
      const sentinel = wakeLock.current;
      wakeLock.current = null;
      setWakeLockActive(false);
      if (sentinel) await sentinel.release();
      setWakeStatus('Der Wachmodus ist ausgeschaltet.');
      return;
    }
    wakeLockWanted.current = true;
    await acquireWakeLock();
  }

  async function toggleFullScreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
        setWakeStatus('Vollbild ist auf diesem Gerät nicht verfügbar. Die Küchenansicht bleibt normal nutzbar.');
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      setWakeStatus('Vollbild wurde nicht freigegeben. Du kannst die Küchenansicht weiterhin normal nutzen.');
    }
  }

  return (
    <div className="stack">
      <div className="button-row">
        <button className="button button-small" type="button" onClick={toggleWakeLock}>{wakeLockActive ? 'Bildschirm freigeben' : 'Bildschirm wach halten'}</button>
        <button className="button button-small" type="button" onClick={toggleFullScreen}>{fullScreen ? 'Vollbild beenden' : 'Vollbild'}</button>
      </div>
      {wakeStatus && <p className="help" role="status">{wakeStatus}</p>}
    </div>
  );
}

