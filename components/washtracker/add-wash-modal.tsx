import React from 'react';
import {Avatar, Button, Card, Dropdown, Input, Modal, Spacer, Text} from '@nextui-org/react';

type Member = {
  id: string;
  displayName?: string;
  nick?: string;
  globalName?: string;
  username?: string;
  avatarUrl?: string;
  isPrevMonthTopDirty?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  isWeeklysTracker?: boolean;
  isEditing: boolean;
  formErr: string;
  filteredMembersForWash: Member[];
  displayNameOf: (m?: Member) => string;
  formMemberId: string;
  setFormMemberId: (value: string) => void;
  formWashRate: number;
  setFormWashRate: (value: number) => void;
  formDirty: string;
  setFormDirty: (value: string) => void;
  dirtyCents: number;
  cleanCents: number;
  formatCentsWhole: (cents: number) => string;
  saving: boolean;
  saveUpsert: () => Promise<void>;
};

export const AddWashModal = ({
  open,
  onClose,
  isWeeklysTracker = false,
  isEditing,
  formErr,
  filteredMembersForWash,
  displayNameOf,
  formMemberId,
  setFormMemberId,
  formWashRate,
  setFormWashRate,
  formDirty,
  setFormDirty,
  dirtyCents,
  cleanCents,
  formatCentsWhole,
  saving,
  saveUpsert,
}: Props) => {
  const selectedMember = filteredMembersForWash.find((m) => m.id === formMemberId);
  const dropdownItems: Array<{id: string; member?: Member}> = [
    {id: '__none__'},
    ...filteredMembersForWash.map((m) => ({id: m.id, member: m})),
  ];
  const memberLabel = (m?: Member) => (
    <span>
      {displayNameOf(m)}
      {m?.isPrevMonthTopDirty ? (
        <span style={{color: '#fbbf24', marginLeft: 6, fontSize: 12, verticalAlign: 'middle'}}>★</span>
      ) : null}
    </span>
  );

  return (
    <Modal
      closeButton
      blur
      aria-label="Add wash"
      open={open}
      onClose={onClose}
      width="720px"
      css={{
        background: 'rgba(0,0,0,0.22)',
        border: '2px solid var(--reblas-outline)',
        backdropFilter: 'blur(14px)',
        borderRadius: 14,
      }}
    >
      <Modal.Header>
        <div style={{display: 'flex', flexDirection: 'column', gap: 4, width: '100%'}}>
          <Text b css={{mb: 0}}>
            {isWeeklysTracker ? 'Add Weekly' : isEditing ? 'Edit wash' : 'Add wash'}
          </Text>
          {!isWeeklysTracker ? (
            <Text size="$xs" css={{opacity: 0.75, mb: 0}}>
              Dirty × (100% − Wash Rate) = Clean
            </Text>
          ) : null}
        </div>
      </Modal.Header>

      <Modal.Body>
        {formErr ? (
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              border: '2px solid var(--reblas-outline)',
              background: 'rgba(120,0,0,0.20)',
            }}
          >
            <Text b css={{mb: 0}}>
              Error
            </Text>
            <Text size="$sm" css={{opacity: 0.9, mb: 0}}>
              {formErr}
            </Text>
          </div>
        ) : null}

        <Card
          css={{
            p: '$8',
            background: 'rgba(0,0,0,0.26)',
            border: '2px solid var(--reblas-outline)',
            borderRadius: 14,
          }}
        >
          <div style={{display: 'grid', gridTemplateColumns: isWeeklysTracker ? '1fr' : '1fr 180px', gap: 12}}>
            <div>
              <Text size="$xs" css={{opacity: 0.75, mb: 6, letterSpacing: '0.06em', textTransform: 'uppercase'}}>
                Member
              </Text>
              <Dropdown>
                <Dropdown.Trigger>
                  <button
                    type="button"
                    aria-label="Select member"
                    style={{
                      width: '100%',
                      height: 44,
                      borderRadius: 14,
                      background: 'rgba(0,0,0,0.28)',
                      border: '1px solid rgba(255,255,255,0.22)',
                      color: 'white',
                      padding: '0 12px',
                      outline: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      cursor: 'pointer',
                    }}
                  >
                    {selectedMember ? (
                      <span style={{display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0}}>
                        <Avatar
                          src={selectedMember.avatarUrl || undefined}
                          size="sm"
                          css={{boxShadow: '0 0 0 1px var(--reblas-outline)', minWidth: 24, width: 24, height: 24}}
                        />
                        <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                          {memberLabel(selectedMember)}
                        </span>
                      </span>
                    ) : (
                      <span style={{opacity: 0.72}}>Select a member…</span>
                    )}
                    <span style={{opacity: 0.72}}>▾</span>
                  </button>
                </Dropdown.Trigger>

                <Dropdown.Menu
                  aria-label="Member list"
                  items={dropdownItems}
                  onAction={(key) => {
                    const k = String(key || '');
                    setFormMemberId(k === '__none__' ? '' : k);
                  }}
                  css={{maxHeight: 320, overflowY: 'auto'}}
                >
                  {(item: any) =>
                    item.id === '__none__' ? (
                      <Dropdown.Item key={item.id} textValue="Select a member">
                        <Text size="$sm" css={{mb: 0, opacity: 0.75}}>
                          Select a member…
                        </Text>
                      </Dropdown.Item>
                    ) : (
                      <Dropdown.Item key={item.id} textValue={displayNameOf(item.member)}>
                        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                          <Avatar
                            src={item.member?.avatarUrl || undefined}
                            size="sm"
                            css={{boxShadow: '0 0 0 1px var(--reblas-outline)', minWidth: 24, width: 24, height: 24}}
                          />
                          <span style={{fontSize: 14, lineHeight: 1.2}}>{memberLabel(item.member)}</span>
                        </div>
                      </Dropdown.Item>
                    )
                  }
                </Dropdown.Menu>
              </Dropdown>
            </div>

            {!isWeeklysTracker ? (
              <Input
                aria-label="Wash rate percent"
                label="Wash Rate %"
                type="number"
                min={0}
                max={100}
                bordered
                fullWidth
                value={String(formWashRate)}
                onChange={(e) => setFormWashRate(Number(e.target.value))}
                css={{
                  '& .nextui-input-wrapper': {
                    border: '1px solid rgba(255,255,255,0.22)',
                    boxShadow: 'none',
                  },
                }}
              />
            ) : null}
          </div>
        </Card>

        <Card
          css={{
            p: '$8',
            background: 'rgba(0,0,0,0.26)',
            border: '2px solid var(--reblas-outline)',
            borderRadius: 14,
          }}
        >
          <div style={{display: 'grid', gridTemplateColumns: isWeeklysTracker ? '1fr' : '1fr 1fr', gap: 12}}>
            <Input
              aria-label="Dirty amount"
              label="Dirty amount"
              placeholder="e.g. 1000"
              bordered
              fullWidth
              value={formDirty}
              onChange={(e) => setFormDirty(String(e?.target?.value || '').replace(/[^0-9]/g, ''))}
              css={{
                '& .nextui-input-wrapper': {
                  border: '1px solid rgba(255,255,255,0.22)',
                  boxShadow: 'none',
                },
              }}
            />

            {!isWeeklysTracker ? (
              <Input
                aria-label="Clean amount"
                label="Clean amount"
                readOnly
                bordered
                fullWidth
                value={formatCentsWhole(cleanCents)}
                css={{
                  '& .nextui-input-wrapper': {
                    border: '1px solid rgba(255,255,255,0.22)',
                    boxShadow: 'none',
                  },
                }}
              />
            ) : null}
          </div>

          {!isWeeklysTracker ? (
            <>
              <Spacer y={0.3} />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 14,
                  border: '2px solid var(--reblas-outline)',
                  background: 'rgba(0,0,0,0.22)',
                }}
              >
                <Text size="$xs" css={{opacity: 0.75, mb: 0}}>
                  Preview
                </Text>
                <Text size="$xs" css={{opacity: 0.85, mb: 0}}>
                  Dirty: <b>{formatCentsWhole(dirtyCents)}</b> • Clean: <b>{formatCentsWhole(cleanCents)}</b> • Rate:{' '}
                  <b>{Math.max(0, Math.min(100, Math.floor(Number(formWashRate || 0))))}%</b>
                </Text>
              </div>
            </>
          ) : null}
        </Card>
      </Modal.Body>

      <Modal.Footer>
        <Button className="reblas-btn-1" auto onPress={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button className="reblas-btn-2" auto onPress={saveUpsert} disabled={saving}>
          {saving ? 'Saving…' : isWeeklysTracker ? 'Add Weekly' : 'Add'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
