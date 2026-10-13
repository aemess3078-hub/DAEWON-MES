import * as React from 'react';
import { cn } from '@/lib/utils';

// @radix-ui/react-progress가 프로젝트 의존성에 없어(package.json 확인) 새 패키지를
// 추가하지 않고 순수 div 2개로 구현한다 — Progress 자체가 트랙+채움 바 두 요소뿐이라
// radix 없이도 접근성 속성을 동일하게 제공할 수 있다.

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => {
    const clamped = Math.min(100, Math.max(0, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
        {...props}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = 'Progress';

export { Progress };
