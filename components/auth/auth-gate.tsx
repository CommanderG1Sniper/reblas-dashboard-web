import React, {useEffect, useRef, useState} from 'react';
import {Button, Card, Text} from '@nextui-org/react';
import {signIn, signOut, useSession} from 'next-auth/react';
import {useGuildSettings} from '../../lib/guild-settings';

function hexToRgba(hex: string, alpha: number) {
  const s = String(hex || '')
    .trim()
    .replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(59,130,246,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const CrewBackdrop = ({sparkleColor, glowColor}: {sparkleColor: string; glowColor: string}) => {
  const twinkles = [
    {x: 12, y: 16, s: 2, d: 3.9, l: 0.2},
    {x: 26, y: 32, s: 3, d: 5.4, l: 1.3},
    {x: 58, y: 14, s: 4, d: 6.1, l: 2.1},
    {x: 73, y: 30, s: 2, d: 4.2, l: 0.9},
    {x: 17, y: 62, s: 3, d: 6.6, l: 0.4},
    {x: 49, y: 66, s: 4, d: 7.2, l: 2.7},
    {x: 79, y: 69, s: 3, d: 5.1, l: 1.9},
    {x: 90, y: 58, s: 2, d: 3.7, l: 0.6},
  ];

  return (
    <>
      <div className="crew-bg" aria-hidden="true">
        <div className="crew-spark crew-spark-a" />
        <div className="crew-spark crew-spark-b" />
        <div className="crew-spark crew-spark-c" />
        {twinkles.map((t, idx) => (
          <span
            key={`crew_twinkle_${idx}`}
            className={`crew-dot crew-dot-${(idx % 3) + 1}`}
            style={{
              left: `${t.x}%`,
              top: `${t.y}%`,
              width: t.s,
              height: t.s,
              animationDuration: `${t.d}s`,
              animationDelay: `${t.l}s`,
            }}
          />
        ))}
      </div>
      <style jsx global>{`
        .crew-bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
          contain: paint;
          transform: translateZ(0);
          background:
            radial-gradient(circle at 15% 18%, ${hexToRgba(glowColor, 0.12)} 0, ${hexToRgba(glowColor, 0.03)} 26%, transparent 45%),
            rgba(0, 0, 0, 0.78);
        }
        .crew-spark {
          position: absolute;
          inset: -20%;
          pointer-events: none;
          opacity: 0.2;
          background-repeat: repeat;
          will-change: transform, opacity;
          backface-visibility: hidden;
          transform: translateZ(0);
        }
        .crew-spark-a {
          background-image:
            radial-gradient(circle at 20% 20%, ${hexToRgba(sparkleColor, 0.95)} 0 0.9px, transparent 1.4px),
            radial-gradient(circle at 75% 60%, ${hexToRgba(sparkleColor, 0.75)} 0 1.8px, transparent 2.6px),
            radial-gradient(circle at 35% 80%, ${hexToRgba(sparkleColor, 0.8)} 0 1.2px, transparent 1.9px);
          background-size: 56px 56px;
          animation: crewFloatA 18s ease-in-out infinite alternate, crewTwinkleA 7.1s ease-in-out infinite;
        }
        .crew-spark-b {
          background-image:
            radial-gradient(circle at 40% 30%, ${hexToRgba(sparkleColor, 0.8)} 0 0.8px, transparent 1.3px),
            radial-gradient(circle at 12% 75%, ${hexToRgba(sparkleColor, 0.55)} 0 1.4px, transparent 2.2px),
            radial-gradient(circle at 82% 18%, ${hexToRgba(sparkleColor, 0.7)} 0 2px, transparent 3px);
          background-size: 72px 72px;
          animation: crewFloatB 24s ease-in-out infinite alternate, crewTwinkleB 9.4s ease-in-out infinite;
        }
        .crew-spark-c {
          background-image:
            radial-gradient(circle at 15% 50%, ${hexToRgba(sparkleColor, 0.95)} 0 0.7px, transparent 1.2px),
            radial-gradient(circle at 55% 25%, ${hexToRgba(sparkleColor, 0.65)} 0 1.1px, transparent 1.8px),
            radial-gradient(circle at 88% 78%, ${hexToRgba(sparkleColor, 0.75)} 0 2.2px, transparent 3.2px);
          background-size: 88px 88px;
          animation: crewFloatC 31s ease-in-out infinite alternate, crewTwinkleC 11.2s ease-in-out infinite;
        }
        .crew-dot {
          position: absolute;
          border-radius: 999px;
          pointer-events: none;
          z-index: 1;
          opacity: 0.1;
          transform: scale(0.75);
          will-change: transform, opacity;
          backface-visibility: hidden;
          animation-name: crewDotTwinkle;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        :root[data-reblas-motion='lite'] .crew-spark-c {
          display: none;
        }
        :root[data-reblas-motion='lite'] .crew-spark-a {
          animation-duration: 24s, 10.8s;
        }
        :root[data-reblas-motion='lite'] .crew-spark-b {
          animation-duration: 30s, 14s;
        }
        :root[data-reblas-motion='reduced'] .crew-spark,
        :root[data-reblas-motion='reduced'] .crew-dot {
          animation: none !important;
          transform: none !important;
        }
        .crew-dot-1 {
          background: ${hexToRgba(sparkleColor, 0.95)};
          box-shadow: 0 0 8px ${hexToRgba(sparkleColor, 0.45)};
        }
        .crew-dot-2 {
          background: ${hexToRgba(sparkleColor, 0.85)};
          box-shadow: 0 0 10px ${hexToRgba(sparkleColor, 0.52)};
        }
        .crew-dot-3 {
          background: ${hexToRgba(sparkleColor, 0.75)};
          box-shadow: 0 0 12px ${hexToRgba(sparkleColor, 0.5)};
        }
        @keyframes crewFloatA {
          0% {
            transform: translate3d(-6px, -4px, 0) scale(1);
          }
          100% {
            transform: translate3d(8px, 10px, 0) scale(1.03);
          }
        }
        @keyframes crewFloatB {
          0% {
            transform: translate3d(5px, -7px, 0) scale(1);
          }
          100% {
            transform: translate3d(-10px, 6px, 0) scale(1.02);
          }
        }
        @keyframes crewFloatC {
          0% {
            transform: translate3d(-4px, 6px, 0) scale(1);
          }
          100% {
            transform: translate3d(9px, -8px, 0) scale(1.01);
          }
        }
        @keyframes crewTwinkleA {
          0%, 100% {
            opacity: 0.1;
          }
          23% {
            opacity: 0.28;
          }
          47% {
            opacity: 0.16;
          }
          71% {
            opacity: 0.3;
          }
        }
        @keyframes crewTwinkleB {
          0%, 100% {
            opacity: 0.08;
          }
          18% {
            opacity: 0.22;
          }
          53% {
            opacity: 0.12;
          }
          79% {
            opacity: 0.26;
          }
        }
        @keyframes crewTwinkleC {
          0%, 100% {
            opacity: 0.06;
          }
          31% {
            opacity: 0.2;
          }
          62% {
            opacity: 0.11;
          }
          86% {
            opacity: 0.18;
          }
        }
        @keyframes crewDotTwinkle {
          0%, 100% {
            opacity: 0.08;
            transform: scale(0.7);
          }
          25% {
            opacity: 0.3;
            transform: scale(1);
          }
          58% {
            opacity: 0.14;
            transform: scale(0.85);
          }
          82% {
            opacity: 0.34;
            transform: scale(1.08);
          }
        }
      `}</style>
    </>
  );
};

const VaultUnlock = ({onUnlock}: {onUnlock: () => void}) => {
  const [phase, setPhase] = useState<'idle' | 'priming' | 'dialing' | 'open'>('idle');
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  };

  const queue = (cb: () => void, delay: number) => {
    const timer = setTimeout(cb, delay);
    timersRef.current.push(timer);
  };

  const trigger = () => {
    if (phase !== 'idle') return;
    setPhase('priming');
    queue(() => setPhase('dialing'), 360);
    queue(() => setPhase('open'), 1300);
    queue(() => onUnlock(), 1880);
  };

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const isBusy = phase !== 'idle';

  return (
    <>
      <div className="vault-wrap">
        <button
          type="button"
          onClick={trigger}
          className={`vault-btn phase-${phase}`}
          aria-label="Unlock with Discord"
          disabled={isBusy}
        >
          <span className="vault-plate" />
          <span className="vault-plate-shine" />
          <span className="vault-rivet vault-rivet-1" />
          <span className="vault-rivet vault-rivet-2" />
          <span className="vault-rivet vault-rivet-3" />
          <span className="vault-rivet vault-rivet-4" />
          <span className="vault-rivet vault-rivet-5" />
          <span className="vault-rivet vault-rivet-6" />
          <span className="vault-rivet vault-rivet-7" />
          <span className="vault-rivet vault-rivet-8" />
          <span className="vault-bolt-track vault-bolt-track-top" />
          <span className="vault-bolt-track vault-bolt-track-right" />
          <span className="vault-bolt-track vault-bolt-track-bottom" />
          <span className="vault-bolt-track vault-bolt-track-left" />
          <span className="vault-bolt vault-bolt-top" />
          <span className="vault-bolt vault-bolt-right" />
          <span className="vault-bolt vault-bolt-bottom" />
          <span className="vault-bolt vault-bolt-left" />
          <span className="vault-handle-core" />
          <span className="vault-handle-arm vault-handle-arm-h" />
          <span className="vault-handle-arm vault-handle-arm-v" />
          <span className="vault-handle-grip vault-handle-grip-l" />
          <span className="vault-handle-grip vault-handle-grip-r" />
          <span className="vault-handle-grip vault-handle-grip-t" />
          <span className="vault-handle-grip vault-handle-grip-b" />
          <span className="vault-status-strip" />
          <span className="vault-led vault-led-1" />
          <span className="vault-led vault-led-2" />
          <span className="vault-led vault-led-3" />
          <span className="vault-center-label">
            <strong>{phase === 'open' ? 'OPEN' : 'UNLOCK'}</strong>
          </span>
        </button>

        <Text
          css={{
            mt: '$10',
            mb: '$1',
            fontSize: '22px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            opacity: 0.92,
            fontWeight: 900,
            textAlign: 'center',
          }}
        >
          {phase === 'idle' ? 'Authorized Member Access Only' : phase === 'priming' ? 'Dial set. Looking for your file…' : phase === 'dialing' ? 'Matching signatures and opening bolts…' : 'Welcome back, capo.'}
        </Text>
      </div>
      <style jsx global>{`
        .vault-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .vault-btn {
          width: min(430px, 92vw);
          height: 270px;
          border: 0;
          border-radius: 20px;
          position: relative;
          cursor: pointer;
          outline: none;
          overflow: hidden;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          background:
            linear-gradient(145deg, rgba(28, 31, 38, 0.98), rgba(6, 7, 10, 1) 55%),
            repeating-linear-gradient(
              125deg,
              rgba(255, 255, 255, 0.025) 0 2px,
              rgba(255, 255, 255, 0) 2px 8px
            );
          box-shadow:
            inset 0 0 38px rgba(79, 130, 186, 0.18),
            inset 0 -14px 22px rgba(0, 0, 0, 0.45),
            0 0 0 2px rgba(144, 197, 255, 0.24),
            0 16px 34px rgba(0, 0, 0, 0.56);
        }
        .vault-btn::before {
          content: '';
          position: absolute;
          inset: 7px;
          border-radius: 14px;
          border: 1px solid rgba(152, 204, 255, 0.17);
          pointer-events: none;
        }
        .vault-btn:hover {
          transform: translateY(-1px) scale(1.01);
          box-shadow:
            inset 0 0 40px rgba(79, 130, 186, 0.22),
            inset 0 -14px 22px rgba(0, 0, 0, 0.45),
            0 0 0 2px rgba(144, 197, 255, 0.28),
            0 18px 38px rgba(0, 0, 0, 0.58);
        }
        .vault-btn:active {
          transform: scale(0.99);
        }
        .vault-plate {
          position: absolute;
          inset: 22px;
          border-radius: 14px;
          background:
            linear-gradient(180deg, rgba(120, 148, 175, 0.16), rgba(13, 17, 22, 0.78)),
            linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0));
          border: 1px solid rgba(144, 196, 255, 0.24);
          box-shadow:
            inset 0 0 24px rgba(122, 173, 231, 0.15),
            inset 0 -10px 18px rgba(0, 0, 0, 0.4);
          transition: transform 0.38s ease;
        }
        .vault-plate-shine {
          position: absolute;
          inset: 22px;
          border-radius: 14px;
          background: linear-gradient(
            118deg,
            transparent 20%,
            rgba(173, 220, 255, 0.08) 34%,
            rgba(173, 220, 255, 0.2) 40%,
            rgba(173, 220, 255, 0.06) 46%,
            transparent 60%
          );
          transform: translateX(-40%);
          animation: vaultPlateSweep 8.4s linear infinite;
          pointer-events: none;
        }
        .vault-rivet {
          position: absolute;
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: radial-gradient(circle at 35% 35%, rgba(191, 221, 255, 0.85), rgba(88, 127, 163, 0.85));
          box-shadow: 0 0 0 1px rgba(139, 190, 245, 0.3), 0 0 5px rgba(74, 136, 197, 0.42);
        }
        .vault-rivet-1 {
          left: 20px;
          top: 20px;
        }
        .vault-rivet-2 {
          left: calc(50% - 4px);
          top: 16px;
        }
        .vault-rivet-3 {
          right: 20px;
          top: 20px;
        }
        .vault-rivet-4 {
          right: 16px;
          top: calc(50% - 4px);
        }
        .vault-rivet-5 {
          right: 20px;
          bottom: 20px;
        }
        .vault-rivet-6 {
          left: calc(50% - 4px);
          bottom: 16px;
        }
        .vault-rivet-7 {
          left: 20px;
          bottom: 20px;
        }
        .vault-rivet-8 {
          left: 16px;
          top: calc(50% - 4px);
        }
        .vault-bolt-track {
          position: absolute;
          background: linear-gradient(180deg, rgba(165, 212, 255, 0.16), rgba(21, 29, 39, 0.64));
          box-shadow: inset 0 0 8px rgba(125, 182, 242, 0.2);
          border: 1px solid rgba(142, 194, 252, 0.2);
          border-radius: 8px;
        }
        .vault-bolt-track-top,
        .vault-bolt-track-bottom {
          left: 50%;
          width: 76px;
          height: 10px;
          transform: translateX(-50%);
        }
        .vault-bolt-track-top {
          top: 28px;
        }
        .vault-bolt-track-bottom {
          bottom: 28px;
        }
        .vault-bolt-track-left,
        .vault-bolt-track-right {
          top: 50%;
          width: 10px;
          height: 72px;
          transform: translateY(-50%);
        }
        .vault-bolt-track-left {
          left: 28px;
        }
        .vault-bolt-track-right {
          right: 28px;
        }
        .vault-handle-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 72px;
          height: 72px;
          margin-left: -36px;
          margin-top: -36px;
          border-radius: 14px;
          background:
            radial-gradient(circle at 35% 28%, rgba(187, 224, 255, 0.28), transparent 42%),
            linear-gradient(145deg, rgba(65, 85, 108, 0.94), rgba(18, 26, 36, 0.94));
          border: 1px solid rgba(150, 202, 255, 0.35);
          box-shadow: inset 0 0 16px rgba(132, 186, 245, 0.2), 0 0 10px rgba(66, 126, 190, 0.28);
          transition: transform 0.34s ease;
        }
        .vault-handle-arm {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 112px;
          height: 10px;
          margin-left: -56px;
          margin-top: -5px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(174, 218, 255, 0.7), rgba(59, 97, 136, 0.9));
          box-shadow: inset 0 0 8px rgba(203, 229, 255, 0.32), 0 0 10px rgba(58, 124, 192, 0.25);
          transform-origin: 50% 50%;
          transition: transform 0.36s ease;
        }
        .vault-handle-arm-v {
          transform: rotate(90deg);
        }
        .vault-handle-grip {
          position: absolute;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: radial-gradient(circle at 35% 35%, rgba(226, 242, 255, 0.8), rgba(80, 124, 166, 0.92));
          box-shadow: 0 0 0 1px rgba(162, 211, 255, 0.32), 0 0 12px rgba(84, 150, 215, 0.32);
          left: 50%;
          top: 50%;
          margin-left: -8px;
          margin-top: -8px;
        }
        .vault-handle-grip-l {
          transform: translateX(-56px);
        }
        .vault-handle-grip-r {
          transform: translateX(56px);
        }
        .vault-handle-grip-t {
          transform: translateY(-56px);
        }
        .vault-handle-grip-b {
          transform: translateY(56px);
        }
        .vault-center-label {
          position: absolute;
          left: 50%;
          top: 66%;
          transform: translate(-50%, -50%);
          font-size: 18px;
          letter-spacing: 0.18em;
          font-weight: 900;
          color: #f6d79a;
          text-transform: uppercase;
          white-space: nowrap;
          text-shadow: 0 0 12px rgba(255, 194, 102, 0.4);
        }
        .vault-status-strip {
          position: absolute;
          left: 50%;
          top: 26%;
          width: 132px;
          height: 16px;
          transform: translateX(-50%);
          border-radius: 999px;
          border: 1px solid rgba(126, 186, 247, 0.3);
          background: linear-gradient(90deg, rgba(12, 25, 42, 0.8), rgba(14, 36, 62, 0.85));
          box-shadow: inset 0 0 9px rgba(89, 149, 214, 0.28);
        }
        .vault-led {
          position: absolute;
          top: 29%;
          width: 8px;
          height: 8px;
          margin-top: -4px;
          border-radius: 999px;
          background: rgba(86, 136, 186, 0.48);
          box-shadow: 0 0 8px rgba(55, 109, 165, 0.26);
        }
        .vault-led-1 {
          left: calc(50% - 36px);
        }
        .vault-led-2 {
          left: calc(50% - 4px);
        }
        .vault-led-3 {
          left: calc(50% + 28px);
        }
        .vault-bolt {
          position: absolute;
          background: linear-gradient(90deg, rgba(186, 224, 255, 0.42), rgba(97, 151, 209, 0.9));
          border-radius: 999px;
          box-shadow: 0 0 10px rgba(90, 153, 218, 0.35), inset 0 0 6px rgba(200, 230, 255, 0.35);
          transition: transform 0.35s ease;
        }
        .vault-bolt-top,
        .vault-bolt-bottom {
          left: 50%;
          width: 54px;
          height: 4px;
          margin-left: -27px;
        }
        .vault-bolt-top {
          top: 31px;
        }
        .vault-bolt-bottom {
          bottom: 31px;
        }
        .vault-bolt-left,
        .vault-bolt-right {
          top: 50%;
          width: 4px;
          height: 54px;
          margin-top: -27px;
        }
        .vault-bolt-left {
          left: 31px;
        }
        .vault-bolt-right {
          right: 31px;
        }
        .vault-btn.phase-priming .vault-handle-core {
          transform: rotate(12deg);
        }
        .vault-btn.phase-dialing .vault-handle-arm-h,
        .vault-btn.phase-dialing .vault-handle-arm-v {
          animation: vaultHandleSweep 0.95s cubic-bezier(0.2, 0.7, 0.24, 1) infinite alternate;
        }
        .vault-btn.phase-dialing .vault-led-1 {
          animation: vaultLedScan 0.9s linear infinite;
        }
        .vault-btn.phase-dialing .vault-led-2 {
          animation: vaultLedScan 0.9s linear infinite 0.2s;
        }
        .vault-btn.phase-dialing .vault-led-3 {
          animation: vaultLedScan 0.9s linear infinite 0.4s;
        }
        .vault-btn.phase-open {
          box-shadow:
            inset 0 0 44px rgba(116, 185, 255, 0.32),
            0 0 0 2px rgba(168, 216, 255, 0.62),
            0 0 50px rgba(84, 157, 230, 0.38);
        }
        .vault-btn.phase-open .vault-bolt-top {
          transform: translateY(-14px);
        }
        .vault-btn.phase-open .vault-bolt-bottom {
          transform: translateY(14px);
        }
        .vault-btn.phase-open .vault-bolt-left {
          transform: translateX(-14px);
        }
        .vault-btn.phase-open .vault-bolt-right {
          transform: translateX(14px);
        }
        .vault-btn.phase-open .vault-plate {
          transform: translateX(10px);
        }
        .vault-btn.phase-open .vault-led {
          background: rgba(147, 237, 184, 0.95);
          box-shadow: 0 0 10px rgba(94, 224, 156, 0.62);
        }
        @keyframes vaultPlateSweep {
          0% {
            transform: translateX(-40%);
          }
          100% {
            transform: translateX(42%);
          }
        }
        @keyframes vaultHandleSweep {
          0% {
            transform: rotate(-24deg);
          }
          100% {
            transform: rotate(30deg);
          }
        }
        @keyframes vaultLedScan {
          0%, 100% {
            background: rgba(94, 146, 196, 0.42);
            box-shadow: 0 0 8px rgba(72, 128, 186, 0.22);
          }
          50% {
            background: rgba(163, 219, 255, 0.95);
            box-shadow: 0 0 12px rgba(120, 188, 247, 0.7);
          }
        }
      `}</style>
    </>
  );
};

export const AuthGate = () => {
  const {data: session, status} = useSession();
  const {settings, loading: settingsLoading} = useGuildSettings();

  const ownerId = String(settings.ownerDiscordId || '').trim();

  // Before owner exists, SetupGate handles it.
  if (!ownerId) return null;

  // Wait until we know auth + settings state
  if (status === 'loading' || settingsLoading) return null;

  // Not logged in -> block app
  if (status !== 'authenticated') {
    return (
      <div
        className="auth-gate-shell"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99998,
          background: '#05070b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 18,
          overflow: 'hidden',
        }}
      >
        <CrewBackdrop
          sparkleColor={settings.memberOfMonthSparkleColor || '#3b82f6'}
          glowColor={settings.memberOfMonthGlowColor || '#3b82f6'}
        />
        <Card
          className="vault-login-card"
          css={{
            p: '$18',
            maxWidth: '1120px',
            width: '100%',
            minHeight: '700px',
            background: 'rgba(0,0,0,0.55)',
            border: '2px solid var(--reblas-outline)',
            backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
            zIndex: 2,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div className="vault-card-aura" />
          <div className="vault-card-sweep" />
          <div className="vault-card-caustic" />
          <div className="vault-card-noise" />
          <div className="vault-card-border-glow" />
          <Text
            h2
            css={{
              mb: '$4',
              textTransform: 'uppercase',
              letterSpacing: '0.09em',
              textAlign: 'center',
              color: '#f6d79a',
              textShadow: '0 0 18px rgba(255,194,102,0.28)',
              fontSize: 'clamp(44px, 7vw, 82px)',
              lineHeight: 1.02,
            }}
          >
            Reblas Dashboard
          </Text>
          <Text css={{opacity: 0.82, mb: '$12', textAlign: 'center'}}>
            Prove your standing and unlock the ledger.
          </Text>

          <VaultUnlock onUnlock={() => signIn('discord')} />
        </Card>
        <style jsx global>{`
          .auth-gate-shell {
            contain: layout paint style;
          }
          .vault-login-card {
            animation: vaultCardFloat 7.2s ease-in-out infinite;
            box-shadow:
              inset 0 0 52px rgba(43, 109, 255, 0.1),
              inset 0 0 120px rgba(12, 32, 66, 0.35),
              0 22px 58px rgba(0, 0, 0, 0.62),
              0 0 0 1px rgba(149, 207, 255, 0.08);
            transform-style: preserve-3d;
            will-change: transform;
            backface-visibility: hidden;
            contain: layout paint style;
          }
          .vault-login-card > :not(
              .vault-card-aura
            ):not(
              .vault-card-sweep
            ):not(
              .vault-card-border-glow
            ):not(
              .vault-card-caustic
            ):not(
              .vault-card-noise
            ) {
            position: relative;
            z-index: 2;
          }
          .vault-card-aura,
          .vault-card-sweep,
          .vault-card-caustic,
          .vault-card-noise,
          .vault-card-border-glow {
            position: absolute;
            pointer-events: none;
          }
          .vault-card-aura {
            inset: -15%;
            background:
              radial-gradient(circle at 18% 20%, rgba(74, 162, 255, 0.2), transparent 36%),
              radial-gradient(circle at 82% 78%, rgba(74, 162, 255, 0.12), transparent 44%),
              radial-gradient(circle at 45% 112%, rgba(84, 153, 244, 0.14), transparent 52%);
            opacity: 0.88;
            will-change: opacity;
            animation: vaultAuraPulse 6.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          }
          .vault-card-sweep {
            inset: -40% -60%;
            background: linear-gradient(
              110deg,
              transparent 42%,
              rgba(140, 203, 255, 0.08) 48%,
              rgba(140, 203, 255, 0.26) 51%,
              rgba(140, 203, 255, 0.1) 55%,
              transparent 62%
            );
            transform: translateX(-35%);
            mix-blend-mode: screen;
            will-change: transform, opacity;
            backface-visibility: hidden;
            animation: vaultCardSweep 7.8s linear infinite;
          }
          .vault-card-caustic {
            inset: -26%;
            background:
              conic-gradient(
                from 160deg at 52% 50%,
                rgba(128, 194, 255, 0) 0deg,
                rgba(128, 194, 255, 0.07) 42deg,
                rgba(128, 194, 255, 0.16) 66deg,
                rgba(128, 194, 255, 0.05) 92deg,
                rgba(128, 194, 255, 0) 180deg,
                rgba(128, 194, 255, 0.08) 240deg,
                rgba(128, 194, 255, 0) 360deg
              );
            opacity: 0.28;
            mix-blend-mode: screen;
            will-change: transform;
            backface-visibility: hidden;
            animation: vaultCausticSpin 18s linear infinite;
          }
          .vault-card-noise {
            inset: -8%;
            background-image:
              radial-gradient(circle at 22% 31%, rgba(255, 255, 255, 0.12) 0 0.6px, transparent 1.3px),
              radial-gradient(circle at 74% 59%, rgba(255, 255, 255, 0.08) 0 0.8px, transparent 1.5px),
              radial-gradient(circle at 44% 81%, rgba(255, 255, 255, 0.1) 0 0.7px, transparent 1.4px),
              repeating-linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.06) 0 1px,
                rgba(255, 255, 255, 0) 1px 3px
              );
            background-size: 120px 120px, 140px 140px, 160px 160px, 100% 3px;
            opacity: 0.08;
            mix-blend-mode: soft-light;
            will-change: transform;
            animation: vaultNoiseShift 4.2s steps(2) infinite;
          }
          .vault-card-border-glow {
            inset: 0;
            border-radius: inherit;
            box-shadow:
              inset 0 0 0 1px rgba(125, 190, 255, 0.2),
              inset 0 0 28px rgba(74, 162, 255, 0.12),
              inset 0 0 80px rgba(42, 102, 189, 0.1);
            will-change: opacity;
            animation: vaultBorderPulse 4.6s ease-in-out infinite;
          }
          .vault-card-sweep,
          .vault-card-caustic,
          .vault-card-border-glow {
            transform: translateZ(0);
            backface-visibility: hidden;
          }
          :root[data-reblas-motion='lite'] .vault-login-card {
            animation-duration: 11s;
          }
          :root[data-reblas-motion='lite'] .vault-card-noise,
          :root[data-reblas-motion='lite'] .vault-card-caustic {
            display: none;
          }
          :root[data-reblas-motion='lite'] .vault-card-sweep {
            animation-duration: 11.5s;
          }
          :root[data-reblas-motion='reduced'] .vault-login-card,
          :root[data-reblas-motion='reduced'] .vault-card-aura,
          :root[data-reblas-motion='reduced'] .vault-card-sweep,
          :root[data-reblas-motion='reduced'] .vault-card-border-glow {
            animation: none !important;
            transition: none !important;
            transform: none !important;
          }
          :root[data-reblas-motion='reduced'] .vault-card-noise,
          :root[data-reblas-motion='reduced'] .vault-card-caustic {
            display: none;
          }
          @keyframes vaultCardFloat {
            0%, 100% {
              transform: translate3d(0, 0, 0);
            }
            50% {
              transform: translate3d(0, -5px, 0);
            }
          }
          @keyframes vaultAuraPulse {
            0%, 100% {
              opacity: 0.72;
            }
            50% {
              opacity: 1;
            }
          }
          @keyframes vaultCardSweep {
            0% {
              transform: translateX(-38%) rotate(0.001deg);
            }
            100% {
              transform: translateX(38%) rotate(0.001deg);
            }
          }
          @keyframes vaultCausticSpin {
            from {
              transform: rotate(0deg) scale(1);
            }
            50% {
              transform: rotate(180deg) scale(1.03);
            }
            to {
              transform: rotate(360deg) scale(1);
            }
          }
          @keyframes vaultNoiseShift {
            0% {
              transform: translate3d(0, 0, 0);
            }
            100% {
              transform: translate3d(0, -3px, 0);
            }
          }
          @keyframes vaultBorderPulse {
            0%, 100% {
              opacity: 0.65;
            }
            50% {
              opacity: 1;
            }
          }
        `}</style>
      </div>
    );
  }

  return null;
};
