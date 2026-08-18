import Link from 'next/link';

export default function PostArticlePublishSection() {
  return (
    <section
      aria-labelledby="publish-article-title"
      className="flex min-h-114.25 items-center justify-center rounded-lg bg-(--page-bg) px-6 text-center"
    >
      <div className="max-w-lg">
        <h2
          id="publish-article-title"
          className="m-0 text-2xl font-semibold tracking-[-0.02em] text-(--text-strong)"
        >
          Publish an article
        </h2>
        <p className="mx-auto mb-0 mt-3 max-w-md text-sm leading-6 text-(--text-muted)">
          Open the post editor to write and publish long-form text content.
        </p>
        <Link
          href="/creator/publish"
          className="mt-6 inline-flex h-10 min-w-52 items-center justify-center rounded-sm bg-[#fe2c55] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#e7274c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55]"
        >
          Start writing
        </Link>
      </div>
    </section>
  );
}
