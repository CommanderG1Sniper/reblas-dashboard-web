import React, {useEffect, useMemo, useState} from 'react';
import {Button, Card, Input, Modal, Spacer, Text} from '@nextui-org/react';
import {useGuildSettings} from '../../lib/guild-settings';

type Transaction = {
  id: string;
  date: string;
  description: string;
  dirtyCents: number;
  createdAt: string;
  createdBy: string;
};

type Payload = {
  crewId: string;
  crewName: string;
  transactions: Transaction[];
  totals: {
    dirtyCents: number;
    entryCount: number;
  };
};

const glassCardCss = {
  p: '$10',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

function formatCentsWhole(cents: number) {
  const n = Math.round(Number(cents || 0) / 100);
  try {
    return n.toLocaleString(undefined, {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
  } catch {
    return `$${n.toLocaleString()}`;
  }
}

function formatDateToDmy(raw: string) {
  const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(raw || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function parseMoneyToCents(raw: string) {
  const cleaned = String(raw || '').replace(/[^0-9]/g, '');
  const whole = Math.floor(Number(cleaned));
  return Number.isFinite(whole) && whole > 0 ? whole * 100 : 0;
}

function todayYmd() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const SubCrewWashTracker = () => {
  const {settings} = useGuildSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [date, setDate] = useState(todayYmd());
  const [description, setDescription] = useState('');
  const [dirtyInput, setDirtyInput] = useState('');
  const [formError, setFormError] = useState('');

  const crewName = payload?.crewName || settings.viewerSubCrewName || 'Sub Crew';

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/subcrews/wash');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to load washes (${res.status})`);
      setPayload(json as Payload);
    } catch (e: any) {
      setPayload(null);
      setError(e?.message || 'Failed to load washes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const totalDirty = useMemo(() => Number(payload?.totals?.dirtyCents || 0), [payload]);

  const saveTransaction = async () => {
    const dirtyCents = parseMoneyToCents(dirtyInput);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      setFormError('Date is required.');
      return;
    }
    if (dirtyCents <= 0) {
      setFormError('Dirty amount must be greater than zero.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const res = await fetch('/api/subcrews/wash', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          date,
          description,
          dirtyCents,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to save transaction (${res.status})`);
      setPayload(json as Payload);
      setAddOpen(false);
      setDate(todayYmd());
      setDescription('');
      setDirtyInput('');
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save transaction');
    } finally {
      setSaving(false);
    }
  };

  const deleteTransaction = async (entryId: string) => {
    const ok = window.confirm('Delete this sub crew wash transaction?');
    if (!ok) return;
    try {
      const res = await fetch('/api/subcrews/wash', {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({entryId}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to delete transaction (${res.status})`);
      setPayload(json as Payload);
    } catch (e: any) {
      window.alert(e?.message || 'Failed to delete transaction');
    }
  };

  return (
    <div style={{padding: 16}}>
      <Card css={glassCardCss}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap'}}>
          <div>
            <Text h3 css={{mb: 0}}>{crewName} Wash Tracker</Text>
            <Text size="$sm" css={{opacity: 0.72}}>
              Bulk washes only. Transactions remain isolated to this sub crew.
            </Text>
          </div>
          <Button className="reblas-btn-2" onPress={() => setAddOpen(true)}>
            Add Transaction
          </Button>
        </div>

        <Spacer y={0.8} />

        {error ? (
          <Card css={{p: '$6', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
            <Text b>Error</Text>
            <Text size="$sm">{error}</Text>
          </Card>
        ) : null}

        <div style={{display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) 1fr', gap: 16, alignItems: 'start'}}>
          <Card css={{...glassCardCss, p: '$8'}}>
            <Text size="$sm" css={{opacity: 0.75, letterSpacing: '0.08em', textTransform: 'uppercase'}}>
              Total Dirty Washed
            </Text>
            <Text h2 css={{mb: '$2', color: 'var(--reblas-btn4-color)'}}>
              {formatCentsWhole(totalDirty)}
            </Text>
            <Text size="$sm" css={{opacity: 0.68}}>
              {Number(payload?.totals?.entryCount || 0)} transactions
            </Text>
          </Card>

          <Card css={{...glassCardCss, p: '$8'}}>
            <Text b css={{mb: '$4'}}>Transactions</Text>
            {loading ? (
              <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
            ) : !payload?.transactions?.length ? (
              <Text size="$sm" css={{opacity: 0.7}}>No transactions recorded yet.</Text>
            ) : (
              <div style={{overflowX: 'auto'}}>
                <table style={{width: '100%', borderCollapse: 'collapse', minWidth: 560}}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Description</th>
                      <th style={{...thStyle, textAlign: 'right'}}>Dirty Washed</th>
                      <th style={{...thStyle, textAlign: 'right'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.transactions.map((entry) => (
                      <tr key={entry.id}>
                        <td style={tdStyle}>{formatDateToDmy(entry.date)}</td>
                        <td style={tdStyle}>{entry.description || 'Bulk wash'}</td>
                        <td style={{...tdStyle, textAlign: 'right', color: 'var(--reblas-btn4-color)', fontWeight: 800}}>
                          {formatCentsWhole(entry.dirtyCents)}
                        </td>
                        <td style={{...tdStyle, textAlign: 'right'}}>
                          <Button auto light className="reblas-btn-3" onPress={() => deleteTransaction(entry.id)}>
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </Card>

      <Modal
        closeButton
        blur
        aria-label="Add sub crew transaction"
        open={addOpen}
        onClose={() => {
          if (saving) return;
          setAddOpen(false);
          setFormError('');
        }}
      >
        <Modal.Header>
          <Text b css={{mb: 0}}>Add Transaction</Text>
        </Modal.Header>
        <Modal.Body>
          <Input
            type="date"
            label="Date"
            fullWidth
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label="Description"
            fullWidth
            placeholder="Weekly wash / Mid-week wash"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input
            label="Dirty Washed"
            fullWidth
            placeholder="Enter whole amount"
            value={dirtyInput}
            onChange={(e) => setDirtyInput(String(e.target.value || '').replace(/[^0-9]/g, ''))}
          />
          {formError ? <Text size="$sm" css={{color: 'var(--reblas-btn3-color)'}}>{formError}</Text> : null}
        </Modal.Body>
        <Modal.Footer>
          <Button auto light onPress={() => setAddOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button className="reblas-btn-2" onPress={saveTransaction} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 10px',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  opacity: 0.7,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const tdStyle: React.CSSProperties = {
  padding: '14px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};
