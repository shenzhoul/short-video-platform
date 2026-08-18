import { PostNavigationDirection } from '@hooks/use-post-navigation-wheel';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';

interface PostNavigationControlsProps {
  canPrevious: boolean;
  canNext: boolean;
  className?: string;
  onNavigate: (direction: PostNavigationDirection) => void;
}

export default function PostNavigationControls({
  canPrevious,
  canNext,
  className = '',
  onNavigate
}: PostNavigationControlsProps) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-full border border-white/10 bg-white/8 shadow-lg backdrop-blur-md ${className}`}>
      <button
        type="button"
        disabled={!canPrevious}
        onClick={() => onNavigate('previous')}
        className="flex h-9 w-9 cursor-pointer items-center justify-center text-xl transition hover:bg-white/12 disabled:cursor-default disabled:opacity-25"
        aria-label="Previous post"
      >
        <FiChevronUp className='text-(--text-soft)' />
      </button>
      <button
        type="button"
        disabled={!canNext}
        onClick={() => onNavigate('next')}
        className="flex h-9 w-9 cursor-pointer items-center justify-center text-xl transition hover:bg-white/12 disabled:cursor-default disabled:opacity-25"
        aria-label="Next post"
      >
        <FiChevronDown className='text-(--text-soft)' />
      </button>
    </div>
  );
}
