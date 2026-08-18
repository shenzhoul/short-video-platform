import { Fragment, type ReactNode } from 'react';

export interface PostUploadGuideline {
  title: string;
  description: ReactNode;
  icon: ReactNode;
}

interface PostUploadGuidelinesProps {
  items: PostUploadGuideline[];
}

export default function PostUploadGuidelines({ items }: PostUploadGuidelinesProps) {
  return (
    <div className="flex w-full justify-between">
      <span aria-hidden="true" className="w-0 shrink-0" />
      {items.map((item, index) => (
        <Fragment key={item.title}>
          <article className="flex w-full max-w-[318px] min-w-0 items-center py-5">
            <div className="shrink-0 text-5xl">{item.icon}</div>
            <div className="ml-3 min-w-0">
              <h2 className="m-0 text-sm font-semibold">{item.title}</h2>
              <div className="mt-1 text-xs leading-[17px] text-(--text-muted)">
                {item.description}
              </div>
            </div>
          </article>
          {index < items.length - 1 ? (
            <span
              aria-hidden="true"
              className="mx-3 flex min-w-1 items-center justify-center"
            >
              <span className="h-[58px] w-px bg-(--divider)" />
            </span>
          ) : null}
        </Fragment>
      ))}
      <span aria-hidden="true" className="w-0 shrink-0" />
    </div>
  );
}
