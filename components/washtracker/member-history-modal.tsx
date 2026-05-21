import React from 'react';
import {Avatar, Button, Card, Modal, Spacer, Text} from '@nextui-org/react';

type MemberHistoryPayload = {
  memberId: string;
  totals: {dirtyCents: number; cleanCents: number; entryCount: number};
  entries: Array<{
    weekEnding: string;
    id: string;
    dirtyCents: number;
    cleanCents: number;
    createdAt: string;
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  memberErr: string;
  memberLoading: boolean;
  memberHistory: MemberHistoryPayload | null;
  memberName: React.ReactNode;
  memberAvatarUrl?: string;
  formatCentsWhole: (cents: number) => string;
  isWeeklysTracker?: boolean;
};

export const MemberHistoryModal = ({
  open,
  onClose,
  memberErr,
  memberLoading,
  memberHistory,
  memberName,
  memberAvatarUrl,
  formatCentsWhole,
  isWeeklysTracker = false,
}: Props) => {
  return (
    <Modal closeButton blur aria-label="Member totals" open={open} onClose={onClose} width="980px">
      <Modal.Header>
        <Text b>{isWeeklysTracker ? 'Member weeklys history' : 'Member wash history'}</Text>
      </Modal.Header>

      <Modal.Body>
        {memberErr ? (
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: '2px solid var(--reblas-outline)',
              background: 'rgba(120,0,0,0.20)',
            }}
          >
            <Text b css={{mb: 0}}>
              Error
            </Text>
            <Text size="$sm" css={{opacity: 0.9, mb: 0}}>
              {memberErr}
            </Text>
          </div>
        ) : null}

        {memberLoading ? (
          <Text size="$sm" css={{opacity: 0.7}}>
            Loading…
          </Text>
        ) : memberHistory ? (
          <>
            <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
              <Avatar src={memberAvatarUrl || undefined} size="md" css={{boxShadow: '0 0 0 1px var(--reblas-outline)'}} />
              <div style={{display: 'flex', flexDirection: 'column', lineHeight: 1.15}}>
                <Text b css={{mb: 0}}>
                  {memberName || memberHistory.memberId}
                </Text>
                <Text size="$sm" css={{opacity: 0.75, mb: 0}}>
                  {isWeeklysTracker ? 'Total Dirty Paid' : 'Total Dirty'}: {formatCentsWhole(memberHistory.totals.dirtyCents)} •{' '}
                  {isWeeklysTracker ? 'Total Clean Paid' : 'Total Clean'}: {formatCentsWhole(memberHistory.totals.cleanCents)} • Entries:{' '}
                  {memberHistory.totals.entryCount}
                </Text>
              </div>
            </div>

            <Spacer y={0.6} />

            <Card css={{p: 0, overflow: 'hidden', background: 'rgba(0,0,0,0.10)', border: '2px solid var(--reblas-outline)'}}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isWeeklysTracker ? '160px 170px 170px 1fr' : '140px 160px 160px 120px 120px 1fr',
                  padding: '10px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <Text b size="$sm" css={{mb: 0}}>
                  Week
                </Text>
                <Text b size="$sm" css={{mb: 0}}>
                  Dirty
                </Text>
                <Text b size="$sm" css={{mb: 0}}>
                  Clean
                </Text>
                {!isWeeklysTracker ? (
                  <Text b size="$sm" css={{mb: 0}}>
                    Rate
                  </Text>
                ) : null}
                {!isWeeklysTracker ? (
                  <Text b size="$sm" css={{mb: 0}}>
                    Status
                  </Text>
                ) : null}
                <Text b size="$sm" css={{mb: 0}}>
                  {isWeeklysTracker ? 'Added To Balance' : 'Created'}
                </Text>
              </div>

              <div style={{maxHeight: 520, overflowY: 'auto'}} className="reblas-scrollhide">
                {memberHistory.entries.map((e, idx) => {
                  const bg = idx % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent';
                  return (
                    <div
                      key={e.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isWeeklysTracker ? '160px 170px 170px 1fr' : '140px 160px 160px 120px 120px 1fr',
                        padding: '12px 14px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        background: bg,
                        alignItems: 'center',
                      }}
                    >
                      <Text css={{mb: 0}}>{e.weekEnding}</Text>
                      <Text css={{mb: 0}}>{formatCentsWhole(e.dirtyCents)}</Text>
                      <Text css={{mb: 0}}>{formatCentsWhole(e.cleanCents)}</Text>
                      {!isWeeklysTracker ? <Text css={{mb: 0}}>{(e as any).washRatePct}%</Text> : null}
                      {!isWeeklysTracker ? (
                        <Text css={{mb: 0, color: (e as any).status === 'paid' ? '$green600' : '$warning'}}>
                          {(e as any).status === 'paid' ? 'PAID' : 'PENDING'}
                        </Text>
                      ) : null}
                      <Text css={{mb: 0, opacity: 0.8}}>{e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}</Text>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        ) : (
          <Text size="$sm" css={{opacity: 0.7}}>
            Select a member to view history.
          </Text>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button auto flat onPress={onClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
