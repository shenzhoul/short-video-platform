import { Tooltip } from '@components/ui/tooltip';
import { QuestionOutlinedIcon } from 'src/icons';

interface PostGuidelineTooltipProps {
  title: string;
}

export default function PostGuidelineTooltip({ title }: PostGuidelineTooltipProps) {
  return (
    <Tooltip
      title={title}
      className="bg-[#3b3b48] px-3 py-3 text-sm leading-[18px] text-white"
      width="w-[240px]"
      wrap
    >
      <span className="inline-flex">
        <QuestionOutlinedIcon className="text-sm" />
      </span>
    </Tooltip>
  );
}
