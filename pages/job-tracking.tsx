import React from 'react';
import {Card, Spacer, Text} from '@nextui-org/react';

const cardCss = {
  p: '$12',
  mw: '720px',
  mx: 'auto',
  mt: '$18',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

export default function JobTrackingPage() {
  return (
    <div style={{padding: '32px 20px 64px'}}>
      <Card css={cardCss}>
        <Text h2 css={{mb: '$4'}}>
          Job Tracking Excluded
        </Text>
        <Text css={{opacity: 0.85, lineHeight: 1.8}}>
          This split sandbox does not include the mining and Job Tracking module.
        </Text>
        <Spacer y={0.6} />
        <Text css={{opacity: 0.7, lineHeight: 1.8}}>
          The separate-hosting work here is focused on the core dashboard and the main dashboard bot without any mining-specific pages, settings, imports, or Discord price flows.
        </Text>
      </Card>
    </div>
  );
}
