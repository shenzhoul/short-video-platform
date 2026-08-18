import classNames from 'classnames';
import { FC } from 'react';

interface IProps {
  spinning?: boolean;
  fullScreen?: boolean;
  center?: boolean;
}

const Loader: FC<IProps> = ({ spinning = false, fullScreen = false, center = false }) => {
  return (
    <div
      className={classNames('loader flex items-center justify-center w-full h-full z-9999', {
        hidden: !spinning,
        'fixed bg-surface dark:bg-black top-0 left-0': fullScreen,
        'absolute top-0': center
      })}
    >
      <div className="flex justify-center items-center space-x-1 text-sm opacity-70 dark:text-white">
        <svg
          fill="none"
          className="w-10 h-10 animate-spin"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
          width={32}
          height={32}
        >
          <path
            clipRule="evenodd"
            d="M15.165 8.53a.5.5 0 01-.404.58A7 7 0 1023 16a.5.5 0 011 0 8 8 0 11-9.416-7.874.5.5 0 01.58.404z"
            fill="currentColor"
            fillRule="evenodd"
          />
        </svg>
        <div>Loading...</div>
      </div>
    </div>
  );
};

export default Loader;
