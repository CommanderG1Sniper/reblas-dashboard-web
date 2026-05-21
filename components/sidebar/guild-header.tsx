import React from 'react';
import {Avatar} from '@nextui-org/react';
import {Flex} from '../styles/flex';
import {useGuildSettings} from '../../lib/guild-settings';

function splitTwoLines(name: string) {
  const clean = (name || '').trim();
  if (!clean) return ['Guild', 'Name'];

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return [parts[0], ''];

  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')];
}

export const GuildHeader = () => {
  const {settings} = useGuildSettings();

  const name = settings.guildName?.trim() || 'Guild Name';
  const [line1, line2] = splitTwoLines(name);

  const avatarSrc = settings.guildAvatar?.trim() || undefined;

  return (
    <Flex
      align={'center'}
      css={{
        gap: '14px',
        px: '0px',   // moved left
        py: '14px',
      }}
    >
      <Avatar
        squared
        size="xl"     // 20%+ bigger than lg
        src={avatarSrc}
        text={name ? name[0].toUpperCase() : 'G'}
      />

      <div style={{display: 'flex', flexDirection: 'column', lineHeight: 1.05}}>
        <div style={{fontWeight: 900, fontSize: 22}}>{line1}</div>
        {line2 ? <div style={{fontWeight: 900, fontSize: 22}}>{line2}</div> : null}
      </div>
    </Flex>
  );
};
