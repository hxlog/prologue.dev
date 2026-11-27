/**
 * Render pre-highlighted Shiki HTML with the same .shiki CSS-variable contract
 * as article code blocks. Used by the lazy Agent-entry panel.
 */
export default function ShikiCode({ html }) {
  return (
    <div
      className="agent-code-block"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
