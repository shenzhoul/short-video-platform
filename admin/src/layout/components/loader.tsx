import classNames from 'classnames';

import css from './loader.module.css';

interface ILoaderProps {
  spinning?: boolean;
  fullScreen?: boolean;
}

function Loader({ spinning = false, fullScreen = false }: ILoaderProps) {
  return (
    <div
      className={classNames('loader', css.loader, {
        [css.hidden]: !spinning,
        [css.fullScreen]: fullScreen
      })}
    >
      <div className={css.wrapper}>
        <div className={css.inner} />
        <div className={css.text}>LOADING</div>
      </div>
    </div>
  );
}

export default Loader;
