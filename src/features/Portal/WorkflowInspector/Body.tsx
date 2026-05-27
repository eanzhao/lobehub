'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { WorkflowInspector } from '@/features/WorkflowInspector';

const Body = memo(() => {
  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <WorkflowInspector />
    </Flexbox>
  );
});

export default Body;
