/** Match http(s) URLs; optional trailing punctuation excluded from capture */
const URL_REGEX = /(https?:\/\/[^\s]+?)(?=[.,;:!?)]*\s|$)/g;

export function linkifyText(text: string): React.ReactNode[] {
  const parts = text.split(URL_REGEX);
  return parts.map((part) => {
    if (part.match(/^https?:\/\/./)) {
      return (
        <a
          key={part}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline break-all"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}
