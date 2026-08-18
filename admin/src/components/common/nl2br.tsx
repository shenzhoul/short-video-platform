export default function Nl2br({
  text
}: {
  text: string
}) {
  if (!text) return null;
  return <div dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, "<br>") }} />
}
