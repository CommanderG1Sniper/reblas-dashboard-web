import React, {useMemo, useState} from 'react';
import {Button, Card, Spacer, Text} from '@nextui-org/react';
import {useGuildSettings} from '../lib/guild-settings';
import {useRouter} from 'next/router';

const glassCardCss = {
  p: '$10',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

function normalizeWhole(raw: string) {
  return String(raw || '').replace(/[^0-9]/g, '');
}

function toWhole(raw: string) {
  const n = Math.floor(Number(normalizeWhole(raw)));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function clampRate(n: number) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.floor(n);
}

function formatCurrency(n: number) {
  try {
    return n.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

const WashCalculator = () => {
  const router = useRouter();
  const {settings, loading} = useGuildSettings();
  const isSubCrew = settings.viewerRole === 'subcrew';
  const defaultWashRatePct = Math.max(0, Math.min(100, Math.floor(Number(settings.defaultWashRatePct ?? 25))));
  const [dirtyInput, setDirtyInput] = useState('');
  const [washRate, setWashRate] = useState(String(defaultWashRatePct));
  const [activeField, setActiveField] = useState<'dirty' | 'rate'>('dirty');

  React.useEffect(() => {
    setWashRate(String(defaultWashRatePct));
  }, [defaultWashRatePct]);

  React.useEffect(() => {
    if (!isSubCrew) return;
    router.replace('/members');
  }, [isSubCrew, router]);

  const dirtyAmount = useMemo(() => toWhole(dirtyInput), [dirtyInput]);
  const ratePct = useMemo(() => clampRate(toWhole(washRate)), [washRate]);

  const cleanReturn = useMemo(() => {
    const keepPct = 1 - ratePct / 100;
    return Math.max(0, Math.round(dirtyAmount * keepPct));
  }, [dirtyAmount, ratePct]);

  const setField = (field: 'dirty' | 'rate', value: string) => {
    const cleaned = normalizeWhole(value);
    if (field === 'dirty') {
      setDirtyInput(cleaned);
      return;
    }
    setWashRate(String(clampRate(toWhole(cleaned))));
  };

  const appendDigits = (digits: string) => {
    const current = activeField === 'dirty' ? dirtyInput : washRate;
    const next = normalizeWhole(`${current}${digits}`).slice(0, activeField === 'dirty' ? 12 : 3);
    setField(activeField, next);
  };

  const backspace = () => {
    const current = activeField === 'dirty' ? dirtyInput : washRate;
    setField(activeField, current.slice(0, -1));
  };

  const clearEntry = () => {
    if (activeField === 'dirty') {
      setDirtyInput('');
      return;
    }
    setWashRate(String(defaultWashRatePct));
  };

  const allClear = () => {
    setDirtyInput('');
    setWashRate(String(defaultWashRatePct));
    setActiveField('dirty');
  };

  if (loading || isSubCrew) return null;

  return (
    <div style={{padding: 16}}>
      <Card
        css={{
          ...glassCardCss,
          maxWidth: 560,
          margin: '0 auto',
          background: 'linear-gradient(180deg, rgba(18,18,22,0.82) 0%, rgba(8,8,10,0.92) 100%)',
        }}
      >
        <Text h3 css={{mb: '$2', color: '#3b82f6'}}>
          Wash Calculator
        </Text>
        <Text css={{opacity: 0.8}}>Calculator mode enabled. Tap a field, then use the keypad.</Text>

        <Spacer y={0.8} />

        <Card
          css={{
            p: '$8',
            background: 'rgba(0,0,0,0.38)',
            border: '2px solid var(--reblas-outline)',
          }}
        >
          <div style={{display: 'grid', gap: 10}}>
            <div
              style={{
                width: '100%',
                textAlign: 'left',
                border: activeField === 'dirty' ? '2px solid var(--reblas-btn4-color)' : '1px solid rgba(255,255,255,0.2)',
                borderRadius: 10,
                background: activeField === 'dirty' ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
                padding: '10px 12px',
              }}
            >
              <Text size="$xs" css={{mb: '$1', opacity: 0.7, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                Dirty Collected
              </Text>
              <input
                type="text"
                inputMode="numeric"
                value={dirtyInput}
                onFocus={() => setActiveField('dirty')}
                onClick={() => setActiveField('dirty')}
                onChange={(e) => setField('dirty', e.target.value.slice(0, 12))}
                placeholder="0"
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  padding: 0,
                  color: 'var(--reblas-btn4-color)',
                  fontSize: 28,
                  fontWeight: 700,
                }}
              />
            </div>

            <div
              style={{
                width: '100%',
                textAlign: 'left',
                border: activeField === 'rate' ? '2px solid var(--reblas-btn1-color)' : '1px solid rgba(255,255,255,0.2)',
                borderRadius: 10,
                background: activeField === 'rate' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                padding: '10px 12px',
              }}
            >
              <Text size="$xs" css={{mb: '$1', opacity: 0.7, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                Wash Rate
              </Text>
              <div style={{display: 'flex', alignItems: 'baseline', gap: 6}}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={washRate}
                  onFocus={() => setActiveField('rate')}
                  onClick={() => setActiveField('rate')}
                  onChange={(e) => setField('rate', e.target.value.slice(0, 3))}
                  placeholder={String(defaultWashRatePct)}
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--reblas-btn1-color)',
                    fontSize: 28,
                    fontWeight: 700,
                  }}
                />
                <Text b css={{mb: 0, color: 'var(--reblas-btn1-color)', fontSize: 28}}>%</Text>
              </div>
            </div>
          </div>
        </Card>

        <Spacer y={0.9} />

        <Card
          css={{
            p: '$8',
            background: 'rgba(0,0,0,0.2)',
            border: '2px solid var(--reblas-outline)',
          }}
        >
          <Text css={{opacity: 0.78, letterSpacing: '0.05em', textTransform: 'uppercase'}}>
            Clean Return
          </Text>
          <Text h2 css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>
            {formatCurrency(cleanReturn)}
          </Text>
        </Card>

        <Spacer y={0.9} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          <Button className="reblas-btn-3" auto onPress={allClear}>AC</Button>
          <Button className="reblas-btn-1" auto onPress={clearEntry}>CE</Button>
          <Button className="reblas-btn-1" auto onPress={backspace}>⌫</Button>

          <Button className="reblas-btn-1" auto onPress={() => appendDigits('7')}>7</Button>
          <Button className="reblas-btn-1" auto onPress={() => appendDigits('8')}>8</Button>
          <Button className="reblas-btn-1" auto onPress={() => appendDigits('9')}>9</Button>

          <Button className="reblas-btn-1" auto onPress={() => appendDigits('4')}>4</Button>
          <Button className="reblas-btn-1" auto onPress={() => appendDigits('5')}>5</Button>
          <Button className="reblas-btn-1" auto onPress={() => appendDigits('6')}>6</Button>

          <Button className="reblas-btn-1" auto onPress={() => appendDigits('1')}>1</Button>
          <Button className="reblas-btn-1" auto onPress={() => appendDigits('2')}>2</Button>
          <Button className="reblas-btn-1" auto onPress={() => appendDigits('3')}>3</Button>

          <Button className="reblas-btn-1" auto onPress={() => appendDigits('0')}>0</Button>
          <Button className="reblas-btn-1" auto onPress={() => appendDigits('00')}>00</Button>
          <Button className="reblas-btn-2" auto onPress={() => undefined}>=</Button>
        </div>
      </Card>
    </div>
  );
};

export default WashCalculator;
