/**
 * Native JSON-LD script. Next's guide is explicit that JSON-LD is data, not
 * executable code, so it must be a plain <script> tag rather than next/script.
 * The `<` escape prevents a title containing "</script>" from breaking out.
 */
export default function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
