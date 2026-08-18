import { FC, ReactNode } from 'react';
import { FaInbox } from 'react-icons/fa';

interface NoDataProps {
  title?: string;
  description?: string | ReactNode;
  icon?: ReactNode;
  className?: string;
}

const NoData: FC<NoDataProps> = ({
  title = 'No data available',
  description = '',
  icon,
  className = ''
}) => {
  return (
    <div className={`text-center py-12 ${className}`}>
      <div className="w-[70px] h-[70px] rounded-full inline-flex items-center justify-center bg-surface-soft mb-4">
        {icon ? (
          icon
        ) : (
          <FaInbox size={40} className='inline-block' />
        )}
      </div>
      <h3 className="text-lg font-medium  mb-2">{title}</h3>
      {typeof description === 'string' ? <p className="opacity-60 text-sm max-w-sm mx-auto">{description}</p> : description}
    </div>
  );
};

export default NoData;
