import React from 'react';
import {Svg} from '../../styles/svg';

export const CalculatorIcon = () => {
  return (
    <Svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      css={{
        '& path': {
          fill: '$accents6',
        },
      }}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V4C20 2.9 19.1 2 18 2H6ZM7 5H17V9H7V5ZM8 12H10V14H8V12ZM11 12H13V14H11V12ZM14 12H16V14H14V12ZM8 15H10V17H8V15ZM11 15H13V17H11V15ZM14 15H16V19H14V15Z"
        fill="#969696"
      />
    </Svg>
  );
};

